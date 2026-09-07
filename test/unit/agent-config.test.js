const path = require('node:path');
const {
  normalizeAgentSpecs,
  parseAgentOption,
} = require('../../src/agent-config.js');
const { AgentTank } = require('../../src/index.js');

jest.mock('node-pty', () => ({ spawn: jest.fn() }), { virtual: true });

describe('agent account configuration', () => {
  it('keeps legacy string entries backward compatible', () => {
    expect(normalizeAgentSpecs(['claude'])).toEqual([{
      provider: 'claude',
      id: 'claude',
      alias: null,
      configPath: null,
    }]);
  });

  it('normalizes multiple accounts of one provider with distinct paths', () => {
    const specs = normalizeAgentSpecs([
      { provider: 'codex', alias: 'work', configPath: './codex-work' },
      { provider: 'codex', id: 'personal', configPath: './codex-personal' },
    ], { baseDir: '/srv/accounts' });

    expect(specs).toEqual([
      {
        provider: 'codex',
        id: 'work',
        alias: 'work',
        configPath: path.resolve('/srv/accounts/codex-work'),
      },
      {
        provider: 'codex',
        id: 'personal',
        alias: 'personal',
        configPath: path.resolve('/srv/accounts/codex-personal'),
      },
    ]);
  });

  it('supports separate ids and display aliases', () => {
    expect(normalizeAgentSpecs([{
      provider: 'claude', id: 'client-a', alias: 'Client A'
    }])[0]).toMatchObject({
      provider: 'claude', id: 'client-a', alias: 'Client A'
    });
  });

  it('expands a home-relative config path', () => {
    const spec = normalizeAgentSpecs([{
      provider: 'codex', id: 'work', configPath: '~/.codex-work'
    }])[0];

    expect(spec.configPath).toBe(path.join(require('node:os').homedir(), '.codex-work'));
  });

  it('rejects colliding account ids', () => {
    expect(() => normalizeAgentSpecs([
      { provider: 'codex', alias: 'work' },
      { provider: 'claude', id: 'work' },
    ])).toThrow('Duplicate agent id "work"');
  });

  it('parses repeatable CLI account syntax', () => {
    expect(parseAgentOption('codex:work=/srv/codex-work')).toEqual({
      provider: 'codex',
      id: 'work',
      alias: 'work',
      configPath: '/srv/codex-work',
    });
  });

  it('sets the provider-specific config environment variable', () => {
    const tank = new AgentTank();
    const claude = tank.createAgent({ provider: 'claude', id: 'client', alias: 'Client', configPath: '/srv/claude' });
    const codex = tank.createAgent({ provider: 'codex', id: 'work', alias: 'work', configPath: '/srv/codex' });
    const agy = tank.createAgent({ provider: 'agy', id: 'google', alias: 'google', configPath: '/srv/gemini' });

    expect(claude.getEnv().CLAUDE_CONFIG_DIR).toBe('/srv/claude');
    expect(codex.getEnv().CODEX_HOME).toBe('/srv/codex');
    expect(agy.getEnv().GEMINI_CLI_HOME).toBe('/srv/gemini');
  });

  it('uses account ids as independent status keys', () => {
    const tank = new AgentTank();
    const work = tank.createAgent({ provider: 'codex', id: 'work', alias: 'Work', configPath: '/srv/work' });
    const personal = tank.createAgent({ provider: 'codex', id: 'personal', alias: 'Personal', configPath: '/srv/personal' });
    tank.agents.set('work', work);
    tank.agents.set('personal', personal);

    const status = tank.getStatus();

    expect(Object.keys(status)).toEqual(['work', 'personal']);
    expect(status.work).toMatchObject({ id: 'work', alias: 'Work', provider: 'codex' });
    expect(status.personal).toMatchObject({ id: 'personal', alias: 'Personal', provider: 'codex' });
  });
});
