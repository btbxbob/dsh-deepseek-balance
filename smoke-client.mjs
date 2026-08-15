// Simulates the harness client module loader to smoke-test the bundle:
// - registers the factory via window.__ModuleLoader__.load
// - materializes it with stub require() for react
// - calls apply(ctx) with a stub slots registry and asserts the registration
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, 'lib', 'client.js'), 'utf8');

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
};

let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (entry) => { loaded = entry; } } };

const factory = new Function('require', bundle + '\nreturn typeof window.__ModuleLoader__.load === "function" ? undefined : undefined;');
// execute the bundle: it calls window.__ModuleLoader__.load({id, factory})
new Function('require', bundle)((spec) => {
  if (spec === 'react') return ReactStub;
  throw new Error('unexpected require: ' + spec);
});

if (!loaded) throw new Error('bundle did not call __ModuleLoader__.load');
console.log('registered id:', loaded.id);

const mod = { exports: {} };
const exportsObj = loaded.factory((spec) => {
  if (spec === 'react') return ReactStub;
  throw new Error('unexpected require during factory: ' + spec);
});
console.log('exports:', Object.keys(exportsObj).join(', '));
console.log('name:', exportsObj.name);
console.log('inject:', JSON.stringify(exportsObj.inject));

// apply with a stub slots service
let registered = null;
const ctx = {
  effect: (fn) => { fn(); },
  slots: {
    register: (options, component) => {
      registered = { options, component };
      return () => { registered = null; };
    },
  },
};
exportsObj.apply(ctx);
if (!registered || registered.options.name !== 'sidebar.footer.action') throw new Error('slot registration missing/wrong');
console.log('slot:', registered.options.name, '| id:', registered.options.id, '| order:', registered.options.order);
console.log('component is function:', typeof registered.component === 'function');

// render the badge with a fake data payload through the component's hooks is
// not exercised (hooks need a real React renderer); the registration is the
// boot-time contract.
console.log('SMOKE OK');
