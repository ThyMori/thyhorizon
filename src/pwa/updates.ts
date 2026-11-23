// Mises à jour : vérifie qu'une nouvelle version existe (au retour sur l'application, quand le réseau revient,
// puis toutes les 30 minutes) et prévient quand le service worker de la nouvelle version a pris la main.
// Rien ne se recharge tout seul : c'est la personne qui choisit le moment.

// Ce dont on a besoin du navigateur (les vraies valeurs conviennent ; des faux servent aux tests).
export interface SwLike {
  controller: unknown; // service worker qui contrôle la page (null à la toute première visite)
  ready: Promise<{ update(): Promise<unknown> }>; // inscription prête, avec sa méthode de vérification
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
}
export interface DocLike {
  visibilityState: string; // « visible » quand l'onglet est au premier plan
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}
export interface WinLike {
  addEventListener(type: 'online', listener: () => void): void;
  removeEventListener(type: 'online', listener: () => void): void;
}

export interface WatchOptions {
  sw: SwLike | null | undefined; // null si le navigateur n'a pas de service worker
  onUpdate: () => void; // appelé quand une nouvelle version est prête
  intervalMs?: number; // délai entre deux vérifications (30 minutes par défaut)
  doc: DocLike;
  win: WinLike;
}

// Renvoie deux fonctions : « checkNow » (vérifie tout de suite) et « stop » (arrête la surveillance).
export function watchUpdates({ sw, onUpdate, intervalMs = 30 * 60 * 1000, doc, win }: WatchOptions): { checkNow: () => Promise<void>; stop: () => void } {
  if (!sw) return { checkNow: async () => {}, stop: () => {} }; // pas de service worker : rien à surveiller
  let hadController = Boolean(sw.controller); // la page était-elle déjà contrôlée ? (sinon c'est la première installation)
  let registration: { update(): Promise<unknown> } | null = null;

  const checkNow = async (): Promise<void> => {
    if (!registration) return; // pas encore prête
    try {
      await registration.update(); // demande au serveur s'il existe un nouveau service worker
    } catch {
      /* hors ligne ou service worker indisponible : sans conséquence */
    }
  };
  const onChange = (): void => {
    if (!hadController) {
      hadController = true; // première installation : rien à recharger
      return;
    }
    onUpdate(); // une version plus récente a pris la main : on prévient
  };
  const onVisible = (): void => {
    if (doc.visibilityState === 'visible') void checkNow(); // retour au premier plan
  };
  const onOnline = (): void => void checkNow(); // le réseau est revenu

  sw.addEventListener('controllerchange', onChange);
  sw.ready.then((r) => (registration = r)).catch(() => {});
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', onOnline);
  const timer = setInterval(onVisible, intervalMs);
  return {
    checkNow,
    stop: () => {
      clearInterval(timer);
      sw.removeEventListener('controllerchange', onChange);
      doc.removeEventListener('visibilitychange', onVisible);
      win.removeEventListener('online', onOnline);
    },
  };
}
