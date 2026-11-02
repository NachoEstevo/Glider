import test from 'node:test';
import assert from 'node:assert/strict';
import { UI } from '../src/ui/ui.js';

function flightUi() {
  const ui = Object.create(UI.prototype);
  ui.flightUi = false;
  ui.hidden = false;
  ui.helpHidden = false;
  ui.el = Object.fromEntries(['hud', 'info', 'help', 'audioControls'].map(name => {
    const classes = new Set(['hidden']);
    return [name, { classList: {
      toggle(value, force) { if (force) classes.add(value); else classes.delete(value); },
      contains(value) { return classes.has(value); },
    } }];
  }));
  return ui;
}

globalThis.matchMedia = () => ({ matches: false });

test('flight controls stay visible past the previous automatic hide deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = flightUi();
  ui.enableFlightUi();
  t.mock.timers.tick(60000);
  assert.equal(ui.el.help.classList.contains('hidden'), false);
  ui.toggleHidden();
  for (const element of Object.values(ui.el)) assert.equal(element.classList.contains('hidden'), true);
  ui.toggleHidden();
  for (const element of Object.values(ui.el)) assert.equal(element.classList.contains('hidden'), false);
});

test('only a manual help toggle changes the control strip preference', () => {
  const ui = flightUi();
  ui.enableFlightUi();
  ui.toggleHelp();
  ui.toggleHidden();
  ui.toggleHidden();
  assert.equal(ui.el.help.classList.contains('hidden'), true);
  assert.equal(ui.el.hud.classList.contains('hidden'), false);
  ui.toggleHelp();
  assert.equal(ui.el.help.classList.contains('hidden'), false);
});
