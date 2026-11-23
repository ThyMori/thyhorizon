// Aides pour retrouver les éléments de la page.

// Renvoie l'élément portant cet identifiant, ou lève une erreur claire s'il manque (index.html et le code doivent rester d'accord).
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable dans index.html`);
  return el as T;
}
