window.__ModuleLoader__.load({
  id: '@local/workbench',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PANEL = 'workbench';
    function Icon({ size }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h('path', { d: 'M8 8v8M12 8v5M16 8v10' }));
    }
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function Page() {
          const [out, setOut] = React.useState('');
          const call = async (endpoint, payload) => {
            setOut('…');
            try { setOut(JSON.stringify(await ctx.connection.rpc.call('/workbench', endpoint, payload ?? {}), null, 2)); }
            catch (e) { setOut('ERR ' + (e && e.message)); }
          };
          const btn = { padding: '6px 12px', marginRight: 8, background: 'var(--dsw-alias-surface-secondary, #eee)', color: 'inherit', border: '1px solid var(--dsw-alias-border-default, #ccc)', borderRadius: 6 };
          return h('div', { style: { padding: 24, color: 'var(--dsw-alias-text-primary, inherit)' } },
            h('h2', null, '工作台 Hello'),
            h('button', { style: btn, onClick: () => call('ping') }, 'ping Host'),
            h('button', { style: btn, onClick: () => call('selftest', { cwd: '/Users/laihuibo/Documents/dsh-plugin' }) }, '创建会话并等待 turn/end'),
            h('pre', { id: 'wb-out' }, out));
        }
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL, order: 20, label: () => '工作台' }, Icon));
      },
    };
  },
});
