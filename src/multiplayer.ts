import { DbConnection } from './module_bindings';
import { projectSchema, validateProject, type Command, type Project } from './domain';

export interface ConnectionOptions {
  uri: string; database: string; code: string; host: boolean; project: Project; playerId: string; name: string; color: string;
}
export interface LiveSession {
  /** Identity hex of the player who created the room; empty for rooms created before hosts were recorded. */
  connection: DbConnection; identity: string; code: string; host: string;
  send: (command: Command, actor: string) => Promise<void>;
  undo: (actor: string) => Promise<void>;
  disconnect: () => void;
}
export function connectRoom(options: ConnectionOptions, onState: (p: Project, undo: { count: number; notice: string }) => void, onError: (message: string) => void, onDisconnect: () => void): Promise<LiveSession> {
  return new Promise((resolve, reject) => {
    const tokenKey = `tablecraft.token:${options.uri}:${options.database}`;
    let settled = false;
    let intentional = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; connection.disconnect(); reject(new Error('Connection timed out. Check the SpaceTimeDB address and database.')); }
    }, 12000);
    const fail = (error: Error) => {
      if (!settled) { settled = true; clearTimeout(timeout); connection.disconnect(); reject(error); }
      else onError(error.message);
    };
    const connection = DbConnection.builder()
      .withUri(options.uri)
      .withDatabaseName(options.database)
      .withToken(localStorage.getItem(tokenKey) ?? undefined)
      .onConnect(async (conn, identity, token) => {
        try {
          localStorage.setItem(tokenKey, token);
          const receive = () => {
            try {
              const row = [...conn.db.roomState.iter()].find(r => r.code === options.code);
              if (!row) return;
              onState(validateProject(projectSchema.parse(JSON.parse(row.state))), { count: row.undoCount, notice: row.undoNotice });
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve({
                  connection: conn, identity: identity.toHexString(), code: options.code, host: row.host,
                  send: (command, actor) => conn.reducers.dispatch({ command: JSON.stringify(command), actor }),
                  undo: actor => conn.reducers.undo({ actor }),
                  disconnect: () => { intentional = true; conn.disconnect(); },
                });
              }
            } catch (error) { fail(error instanceof Error ? error : new Error('Invalid room state.')); }
          };
          conn.db.roomState.onInsert(receive);
          conn.db.roomState.onUpdate(receive);
          conn.subscriptionBuilder().onApplied(receive).onError(ctx => fail(new Error(String(ctx.event))))
            .subscribe('SELECT * FROM room_state');
          await conn.reducers.joinRoom({
            code: options.code, initialState: options.host ? JSON.stringify(options.project) : '',
            playerId: options.playerId, name: options.name, color: options.color,
          });
        } catch (error) { fail(error instanceof Error ? error : new Error('Unable to join room.')); }
      })
      .onConnectError((_ctx, error) => fail(error))
      .onDisconnect(() => { if (settled && !intentional) onDisconnect(); })
      .build();
  });
}
