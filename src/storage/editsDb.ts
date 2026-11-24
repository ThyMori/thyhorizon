// L'enregistrement durable des modifications du monde, dans IndexedDB (le stockage du navigateur, sur cet ordinateur uniquement).
// Si IndexedDB est indisponible (navigation privée, blocage), on garde tout en mémoire : le jeu marche, mais rien ne survit au rechargement
// (`persistent` vaut alors false, pour prévenir le joueur).

export interface EditsPersistence {
  readonly persistent: boolean; // les données survivent-elles au rechargement ?
  loadAll(): Promise<unknown[]>;
  put(edit: { id: string }): Promise<void>;
  delete(id: string): Promise<void>;
}

const STORE = 'edits';

// Repli sans stockage durable.
export function memoryPersistence(): EditsPersistence {
  const m = new Map<string, unknown>();
  return {
    persistent: false,
    loadAll: async () => [...m.values()],
    put: async (e) => void m.set(e.id, e),
    delete: async (id) => void m.delete(id),
  };
}

// Transforme une requête IndexedDB en promesse.
const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Ouvre la base ; en cas d'échec, renvoie le repli mémoire (sans jamais lever d'exception).
export async function openEditsDb(name = 'thyhorizon', factory: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<EditsPersistence> {
  if (!factory) return memoryPersistence();
  try {
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' }); // première ouverture : on crée le tiroir
    };
    const db = await wrap(open);
    const tx = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
    return {
      persistent: true,
      loadAll: () => wrap(tx('readonly').getAll()),
      put: async (e) => void (await wrap(tx('readwrite').put(e))),
      delete: async (id) => void (await wrap(tx('readwrite').delete(id))),
    };
  } catch {
    return memoryPersistence(); // blocage, quota… : on continue sans sauvegarde durable
  }
}
