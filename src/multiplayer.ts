import { DbConnection } from './module_bindings';
import { projectSchema, shareComponents, validateProject, type Command, type Component, type Project } from './domain';

/** `playerId` is the seat a host keeps when creating a room; guests join as viewers. */
export interface ConnectionOptions {
  uri: string; database: string; code: string; host: boolean; project: Project; playerId: string; name: string; color: string;
}
export interface LiveSession {
  /** Identity hex of the player who created the room; empty for rooms created before hosts were recorded. */
  connection: DbConnection; identity: string; code: string; host: string;
  send: (command: Command, actor: string) => Promise<void>;
  undo: (actor: string) => Promise<void>;
  redo: (actor: string) => Promise<void>;
  /** Takes an empty seat (or creates playerId when new), releasing the current one; an empty id watches as a viewer. */
  takeSeat: (playerId: string, name: string, color: string) => Promise<void>;
  disconnect: () => void;
}
export function connectRoom(options: ConnectionOptions, onState: (p: Project, undo: { count: number; notice: string; redo: number }) => void, onError: (message: string) => void, onDisconnect: () => void): Promise<LiveSession> {
  return new Promise((resolve, reject) => {
    const tokenKey = `tablecraft.token:${options.uri}:${options.database}`;
    let settled = false;
    let intentional = false;
    let previousComponents: Component[] = [];
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
              const parsed = validateProject(projectSchema.parse(JSON.parse(row.state)));
              // Keep unchanged designs as the same objects so a room update re-renders only what changed.
              const components = shareComponents(previousComponents, parsed.components);
              previousComponents = components;
              onState({ ...parsed, components }, { count: row.undoCount, notice: row.undoNotice, redo: row.redoCount ?? 0 });
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve({
                  connection: conn, identity: identity.toHexString(), code: options.code, host: row.host,
                  send: (command, actor) => conn.reducers.dispatch({ command: JSON.stringify(command), actor }),
                  undo: actor => conn.reducers.undo({ actor }),
                  redo: actor => conn.reducers.redo({ actor }),
                  takeSeat: (playerId, name, color) => conn.reducers.takeSeat({ playerId, name, color }),
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
