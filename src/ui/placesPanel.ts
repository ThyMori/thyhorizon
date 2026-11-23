// Fenêtre « Lieux » : une liste de boutons, un par lieu du monde (voir core/places.ts). Un appui = voyage immédiat.
// Le texte vient de nos propres données : on utilise quand même textContent, jamais innerHTML.

import { PLACES, Place } from '../core/places';
import { byId } from './dom';

export class PlacesPanel {
  constructor(onPick: (place: Place) => void) {
    const list = byId('places-list'); // conteneur de la liste
    for (const place of PLACES) {
      const button = document.createElement('button'); // un bouton par lieu
      button.type = 'button';
      button.className = 'place';
      const name = document.createElement('strong'); // nom du lieu
      name.textContent = place.name;
      const climate = document.createElement('span'); // description du climat
      climate.textContent = place.climate;
      button.append(name, climate);
      button.addEventListener('click', () => onPick(place));
      list.append(button);
    }
  }
}
