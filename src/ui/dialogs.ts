// Fenêtres de dialogue natives (<dialog>) : réglages et aide.
// Fermées par le bouton ✕, par Échap, par un clic à côté. Le focus va sur le titre, pas sur un champ.

// Y a-t-il une fenêtre ouverte ?
export const anyDialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;

// Ouvre une fenêtre et place le focus sur son titre (pour ne pas ouvrir de liste ni de clavier pour rien).
export function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return; // déjà ouverte
  dialog.showModal();
  dialog.querySelector<HTMLElement>('h2')?.focus(); // le titre porte tabindex="-1"
}

// Branche la fermeture : bouton « data-close », clic à l'extérieur du panneau, et rappel après fermeture.
export function bindDialog(dialog: HTMLDialogElement, onClose: () => void): void {
  for (const button of dialog.querySelectorAll<HTMLElement>('[data-close]')) {
    button.addEventListener('click', () => dialog.close()); // bouton ✕
  }
  dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect(); // rectangle du panneau
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) dialog.close(); // clic sur le voile : on ferme
  });
  dialog.addEventListener('close', onClose); // quelle que soit la façon de fermer (Échap, bouton, voile)
}
