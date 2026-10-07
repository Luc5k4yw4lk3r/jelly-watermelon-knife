import { createHandKnife } from './handKnife.js';
import { createLineKnife } from './lineKnife/index.js';

/**
 * Una **mecánica** es una forma de cortar. Todas comparten la física, la malla,
 * el jugo y la capa de puntero; se diferencian en cómo el gesto del usuario se
 * vuelve un corte.
 *
 * La interfaz es chica a propósito:
 *
 *   enter()          pasa a estar activa
 *   exit()           deja de estarlo: cancela lo que tenga en curso y se esconde
 *   update(dt, io)   un frame, **antes** de la física
 *   get blades()     estados de hoja que el solver colisiona; puede ser []
 *   dispose()        suelta lo que tenga en la GPU
 *
 * `update` recibe los servicios compartidos por el constructor y los datos del
 * frame por `io`, así que una mecánica no importa nada "hacia arriba" ni toca
 * `main.js`.
 *
 * Lo que una mecánica **no** hace: reconstruir topología, lanzar jugo, sonar el
 * squish o actualizar el HUD. Eso es `onCut`, y vive en un solo lugar.
 */
export const MECHANICS = [
  {
    id: 'handKnife',
    label: 'Tajo libre',
    create: createHandKnife,
    hint: 'Mano <i>lenta</i> empuja &nbsp;·&nbsp; tajo <em>rápido</em> corta &nbsp;·&nbsp; <b>flechas</b> o botón derecho para girar &nbsp;·&nbsp; <b>D</b> tuneo',
  },
  {
    id: 'lineKnife',
    label: 'Cuchillo',
    create: createLineKnife,
    /* Corta por un plano, así que el reparto se puede medir y puntuar. El tajo
       libre barre un cuadrilátero: ahí un split no está definido. */
    scores: true,
    hint: '<b>Arrastrá</b> una línea sobre la sandía y <em>soltá</em> &nbsp;·&nbsp; con la mano, <b>pinza</b> de pulgar e índice &nbsp;·&nbsp; <b>Esc</b> cancela &nbsp;·&nbsp; <b>flechas</b> o botón derecho para girar',
  },
];

export const mechanicById = (id) => MECHANICS.find((m) => m.id === id);
