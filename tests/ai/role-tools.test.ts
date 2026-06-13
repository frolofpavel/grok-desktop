import { describe, it, expect } from 'vitest'
import { getRoleToolset, SUBAGENT_FORBIDDEN_TOOLS } from '../../electron/ai/role-tools'
import { isVerifierCommand } from '../../electron/ai/command-policy'
import { decide } from '../../electron/ai/mode-policy'

// getRoleToolset — security-гейт набора инструментов субагента (Фаза 1
// мультиагентности). Эти тесты фиксируют контракт: какая роль что получает,
// и что delegate_* НИКОГДА не попадает в whitelist (защита от рекурсии).

const WRITE_TOOLS = ['write_file', 'apply_patch', 'propose_edits', 'edit_spreadsheet']
const READ_TOOLS = ['read_file', 'list_directory', 'search_project', 'find_files', 'get_project_map']

describe('getRoleToolset — whitelist по роли', () => {
  describe('read-only роли (researcher / critic / planner) не получают write/command tools', () => {
    for (const role of ['researcher', 'critic', 'planner']) {
      const toolset = getRoleToolset(role)
      it(`${role} содержит read-набор`, () => {
        for (const t of READ_TOOLS) expect(toolset).toContain(t)
      })
      it(`${role} НЕ содержит write-tools`, () => {
        for (const t of WRITE_TOOLS) expect(toolset).not.toContain(t)
      })
      it(`${role} НЕ содержит run_command`, () => {
        expect(toolset).not.toContain('run_command')
      })
    }
  })

  describe('verifier', () => {
    const toolset = getRoleToolset('verifier')
    it('содержит read-набор', () => {
      for (const t of READ_TOOLS) expect(toolset).toContain(t)
    })
    it('содержит check_diagnostics и run_command (проверки)', () => {
      expect(toolset).toContain('check_diagnostics')
      expect(toolset).toContain('run_command')
    })
    it('НЕ содержит write-tools (verifier не правит код)', () => {
      for (const t of WRITE_TOOLS) expect(toolset).not.toContain(t)
    })
  })

  describe('executor', () => {
    const toolset = getRoleToolset('executor')
    it('содержит read-набор', () => {
      for (const t of READ_TOOLS) expect(toolset).toContain(t)
    })
    it('содержит apply_patch / write_file / run_command', () => {
      expect(toolset).toContain('apply_patch')
      expect(toolset).toContain('write_file')
      expect(toolset).toContain('run_command')
    })
  })

  describe('default (роль не задана)', () => {
    it('null → read-only набор', () => {
      const toolset = getRoleToolset(null)
      for (const t of READ_TOOLS) expect(toolset).toContain(t)
      for (const t of WRITE_TOOLS) expect(toolset).not.toContain(t)
      expect(toolset).not.toContain('run_command')
    })
    it('неизвестная роль → read-only набор', () => {
      const toolset = getRoleToolset('something-weird')
      for (const t of WRITE_TOOLS) expect(toolset).not.toContain(t)
      expect(toolset).not.toContain('run_command')
    })
    it('undefined → read-only набор', () => {
      expect(getRoleToolset()).toEqual(getRoleToolset(null))
    })
  })

  describe('delegate-tools исключены ВСЕГДА (защита от рекурсии)', () => {
    for (const role of ['researcher', 'critic', 'planner', 'verifier', 'executor', null, 'unknown']) {
      it(`роль ${role ?? 'default'}: нет delegate_task / delegate_parallel`, () => {
        const toolset = getRoleToolset(role)
        expect(toolset).not.toContain('delegate_task')
        expect(toolset).not.toContain('delegate_parallel')
      })
    }
    it('SUBAGENT_FORBIDDEN_TOOLS содержит оба delegate-тула', () => {
      expect(SUBAGENT_FORBIDDEN_TOOLS.has('delegate_task')).toBe(true)
      expect(SUBAGENT_FORBIDDEN_TOOLS.has('delegate_parallel')).toBe(true)
    })
    it('orchestrate тоже запрещён субам (Фаза 3 — вызывает только главный агент)', () => {
      expect(SUBAGENT_FORBIDDEN_TOOLS.has('orchestrate')).toBe(true)
      for (const role of ['researcher', 'critic', 'planner', 'verifier', 'executor', null]) {
        expect(getRoleToolset(role)).not.toContain('orchestrate')
      }
    })
  })

  describe('TodoGate доступ по ролям (Фаза 3, Идея 2)', () => {
    it('planner может создавать todo-лист (todo_create)', () => {
      expect(getRoleToolset('planner')).toContain('todo_create')
    })
    it('executor/researcher/verifier берут/закрывают пункты (todo_update/todo_list)', () => {
      for (const role of ['executor', 'researcher', 'verifier']) {
        expect(getRoleToolset(role)).toContain('todo_update')
        expect(getRoleToolset(role)).toContain('todo_list')
      }
    })
    it('todo_create НЕ у субов-исполнителей (лист создаёт planner/главный агент)', () => {
      for (const role of ['executor', 'researcher', 'verifier', 'critic', null]) {
        expect(getRoleToolset(role)).not.toContain('todo_create')
      }
    })
  })

  describe('per-sub memory (Фаза 3, Идея 8)', () => {
    it('researcher / verifier / executor сохраняют находки через memory_save', () => {
      for (const role of ['researcher', 'verifier', 'executor']) {
        expect(getRoleToolset(role)).toContain('memory_save')
      }
    })
    it('critic / неизвестная роль не получают memory_save', () => {
      expect(getRoleToolset('critic')).not.toContain('memory_save')
      expect(getRoleToolset(null)).not.toContain('memory_save')
    })
  })
})

describe('mode-policy интеграция: executor проходит decide() для write-tools', () => {
  // Субагент executor правит файлы через тот же mode-policy.decide, что и
  // главный агент — в ask он подтверждается, в plan блокируется.
  it('apply_patch в ask → confirm (не auto-accept)', () => {
    expect(decide('apply_patch', 'ask')).toBe('confirm')
  })
  it('apply_patch в plan → block', () => {
    expect(decide('apply_patch', 'plan')).toBe('block')
  })
  it('apply_patch в accept-edits → auto-accept', () => {
    expect(decide('apply_patch', 'accept-edits')).toBe('auto-accept')
  })
})

describe('isVerifierCommand — whitelist проверочных команд verifier', () => {
  it('пропускает test/typecheck/lint', () => {
    expect(isVerifierCommand('npm test')).toBe(true)
    expect(isVerifierCommand('npm run type')).toBe(true)
    expect(isVerifierCommand('npm run lint')).toBe(true)
    expect(isVerifierCommand('npx tsc --noEmit')).toBe(true)
    expect(isVerifierCommand('npx vitest run')).toBe(true)
    expect(isVerifierCommand('pnpm vitest')).toBe(true)
    expect(isVerifierCommand('eslint src/')).toBe(true)
  })
  it('отклоняет не-проверочные команды', () => {
    expect(isVerifierCommand('npm install lodash')).toBe(false)
    expect(isVerifierCommand('git push')).toBe(false)
    expect(isVerifierCommand('node script.js')).toBe(false)
    expect(isVerifierCommand('echo hello')).toBe(false)
    expect(isVerifierCommand('')).toBe(false)
  })
  it('отклоняет разрушающие команды даже если они «похожи» на проверку', () => {
    // denylist бьёт раньше allow-листа
    expect(isVerifierCommand('rm -rf / && npm test')).toBe(false)
  })
})
