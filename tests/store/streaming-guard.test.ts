import { describe, it, expect } from 'vitest'
import {
  buildComposerReconcilePatch,
  inflightSendForChat,
  isActiveChatBusy
} from '../../src/store/streaming-guard'

describe('streaming-guard', () => {
  it('inflightSendForChat находит owner по chatId', () => {
    const owners = {
      7: { kind: 'chat' as const, chatId: 42 },
      8: { kind: 'review' as const, reviewChatId: 1, parentChatId: 42 }
    }
    expect(inflightSendForChat(owners, 42)).toBe(7)
    expect(inflightSendForChat(owners, 99)).toBeNull()
  })

  it('isActiveChatBusy учитывает outbound до registerSendOwner', () => {
    expect(isActiveChatBusy(5, {}, 5)).toBe(true)
    expect(isActiveChatBusy(5, {}, null)).toBe(false)
  })

  it('buildComposerReconcilePatch снимает залипший isStreaming без active send', () => {
    const patch = buildComposerReconcilePatch({
      activeChatId: 10,
      isStreaming: true,
      sendOwners: { 3: { kind: 'chat', chatId: 10 } },
      outboundChatId: null,
      pendingCommand: null,
      pendingWrites: []
    }, [])
    expect(patch.isStreaming).toBe(false)
    expect(patch.sendOwners).toEqual({})
  })

  it('buildComposerReconcilePatch оставляет busy при живом send в main', () => {
    const patch = buildComposerReconcilePatch({
      activeChatId: 10,
      isStreaming: false,
      sendOwners: { 3: { kind: 'chat', chatId: 10 } },
      outboundChatId: null,
      pendingCommand: null,
      pendingWrites: []
    }, [3])
    expect(patch.isStreaming).toBe(true)
    expect(patch.sendOwners).toBeUndefined()
  })

  it('buildComposerReconcilePatch чистит pendingCommand от мёртвого sendId', () => {
    const patch = buildComposerReconcilePatch({
      activeChatId: 1,
      isStreaming: false,
      sendOwners: {},
      outboundChatId: null,
      pendingCommand: { callId: 'c1', command: 'ls', sendId: 9 },
      pendingWrites: []
    }, [])
    expect(patch.pendingCommand).toBeNull()
  })
})