import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DbConnection } from '../src/module_bindings';
import { applyCommand, commandSchema, projectSchema, validateProject, type Command, type Project } from '../src/domain';

type LiveOptions = { uri: string; database: string; code: string; name: string; color: string; timeout: number; initial?: Project };

export async function live(options: LiveOptions, commands: Command[], actorId?: string, undo = false) {
  const uri = new URL(options.uri);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(uri.protocol) || uri.username || uri.password || uri.search || uri.hash) {
    throw new Error('Server URI must be an HTTP(S) or WS(S) URL without credentials, query, or fragment.');
  }
  if (!['https:', 'wss:'].includes(uri.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) {
    throw new Error('Non-loopback servers require HTTPS or WSS to protect identity tokens.');
  }
  if (!/^[A-Z0-9-]{4,40}$/.test(options.code)) throw new Error('Room codes must contain 4-40 uppercase letters, digits or hyphens.');
  const directory = join(homedir(), '.tablecraft', 'identities');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let ancestor = await realpath(directory);
  while (true) {
    try { await access(join(ancestor, '.git')); throw new Error('Identity directory must be outside a Git repository.'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const key = createHash('sha256').update(`${uri.href}\n${options.database}`).digest('hex');
  const tokenPath = join(directory, `${key}.json`);
  let token: string | undefined;
  try {
    const saved: unknown = JSON.parse(await readFile(tokenPath, 'utf8'));
    if (!saved || typeof saved !== 'object' || !('token' in saved) || typeof saved.token !== 'string' || !saved.token) throw new Error('Invalid identity file.');
    token = saved.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to read the private identity file.');
  }
  let conn: DbConnection | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let completed = 0;
  let closed = false;
  const checkOpen = () => { if (closed) throw new Error('Live operation already ended.'); };
  // The SDK logger writes to stdout; the CLI reserves stdout for its JSON result.
  const log = console.log;
  console.log = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Live operation timed out; a submitted command may have committed. Read state before retrying.')), options.timeout);
      }),
      new Promise<{ identity: string; code: string; revision: number; project: Project; commandsApplied: number }>((resolve, reject) => {
        const fail = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)));
        conn = DbConnection.builder().withUri(options.uri).withDatabaseName(options.database).withToken(token)
          .onConnect(async (connection, identity, newToken) => {
            try {
              const temp = join(directory, `.${key}.${randomUUID()}.tmp`);
              try {
                await writeFile(temp, JSON.stringify({ token: newToken }), { mode: 0o600, flag: 'wx' });
                checkOpen();
                await rename(temp, tokenPath);
              } finally { await rm(temp, { force: true }); }
              checkOpen();
              const identityHex = identity.toHexString();
              await new Promise<void>((ready, failed) => {
                connection.subscriptionBuilder().onApplied(() => ready()).onError(ctx => failed(new Error(String(ctx.event))))
                  .subscribe('SELECT * FROM room_state');
              });
              checkOpen();
              await connection.reducers.joinRoom({
                code: options.code, initialState: options.initial ? JSON.stringify(options.initial) : '',
                playerId: '', name: options.name, color: options.color,
              });
              checkOpen();
              const getRow = () => [...connection.db.roomState.iter()].find(row => row.code === options.code);
              let row = getRow();
              if (!row) throw new Error('Joined room, but no room state was received.');
              let project = validateProject(projectSchema.parse(JSON.parse(row.state)));
              // Guests join as viewers: take the requested seat, else the first empty seat, else a new one.
              const target = actorId ? project.players.find(player => player.id === actorId)
                : project.players.find(player => player.owner === identityHex) ?? project.players.find(player => !player.owner);
              if (actorId && !target) throw new Error('The selected actor seat does not exist in this room.');
              if (target?.owner !== identityHex) {
                await connection.reducers.takeSeat({ playerId: target?.id ?? `player-${randomUUID()}`, name: options.name, color: options.color });
                checkOpen();
                row = getRow();
                if (!row) throw new Error('Room state disappeared after taking a seat.');
                project = validateProject(projectSchema.parse(JSON.parse(row.state)));
              }
              const actor = project.players.find(player => player.owner === identityHex);
              if (!actor) throw new Error('Unable to take a seat for this identity.');
              for (const raw of commands) {
                checkOpen();
                const command = commandSchema.parse(raw);
                // The server is authoritative; this preflight is only for early feedback.
                applyCommand(project, command, actor.id);
                await connection.reducers.dispatch({ command: JSON.stringify(command), actor: actor.id });
                completed++;
                checkOpen();
                row = getRow();
                if (!row) throw new Error('Room state disappeared after dispatch.');
                project = validateProject(projectSchema.parse(JSON.parse(row.state)));
              }
              if (undo) {
                checkOpen();
                await connection.reducers.undo({ actor: actor.id });
                completed++;
                checkOpen();
                row = getRow();
                if (!row) throw new Error('Room state disappeared after undo.');
                project = validateProject(projectSchema.parse(JSON.parse(row.state)));
              }
              resolve({ identity: identityHex, code: options.code, revision: row.revision, project, commandsApplied: completed });
            } catch (error) { fail(error); }
          })
          .onConnectError((_ctx, error) => fail(error))
          .onDisconnect(() => fail(new Error('Live connection disconnected.')))
          .build();
      }),
    ]);
  } catch (error) {
    throw new Error(`Live operation failed after ${completed} confirmed command(s): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    closed = true;
    clearTimeout(timer!);
    conn?.disconnect();
    console.log = log;
  }
}
