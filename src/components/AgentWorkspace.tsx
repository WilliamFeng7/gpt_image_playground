import { useEffect, useMemo, useState, useRef, useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AgentMessage, AgentRound, TaskRecord } from '../types'
import { editOutputs, regenerateAgentAssistantMessage, removeTask, reuseConfig, useStore } from '../store'
import { getActiveAgentRounds, getAgentBranchLeafId, getAgentRoundPath, getAgentRoundTaskIds, getAgentSiblingRounds } from '../lib/agentConversationState'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import { getImageComments, getPromptMentionParts } from '../lib/promptImageMentions'
import { replaceAgentPromptImageReferencesForApi } from '../lib/agentImageReferences'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { getPageScroller, getPageScrollTop } from '../lib/pageScroll'
import type { AgentWebSearchStatus } from '../lib/agentWebSearch'
import { getAgentAssistantBlocks, getAgentAssistantCopyContent, getRoundTaskSlots } from '../lib/agentAssistantBlocks'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { downloadImageEntriesAsZip, downloadImageIds, getDownloadErrorMessage, getImageZipEntries, withSaveLocation } from '../lib/downloadImages'
import { useVisibleAgentConversations } from '../hooks/usePrivacyMode'
import AgentHistorySidebar from './AgentHistorySidebar'
import TaskCard from './TaskCard'
import { CommentBadge } from './CommentMarks'
import MarkdownRenderer from './MarkdownRenderer'
import { TooltipButton as AgentActionButton } from './TooltipButton'
import { TrashIcon, DownloadIcon, EditIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SidebarLeftIcon, FavoriteIcon, CloseIcon, CopyIcon, RefreshIcon, ArrowDownIcon, PlusIcon, SparklesIcon } from './icons'

function ChatImageThumb({ imageId, imageIndex, maskImageId, round }: { imageId: string; imageIndex: number; maskImageId?: string | null; round: AgentRound }) {
  const [src, setSrc] = useState<string>(() => getCachedImage(imageId) || '')
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const commentCount = getImageComments(round.prompt, imageIndex).length

  useEffect(() => {
    let cancelled = false

    if (maskImageId) {
      Promise.all([ensureImageCached(imageId), ensureImageCached(maskImageId)])
        .then(async ([baseUrl, maskUrl]) => {
          if (!baseUrl || !maskUrl) return baseUrl || ''
          return createMaskPreviewDataUrl(baseUrl, maskUrl)
        })
        .then((url) => {
          if (!cancelled && url) setSrc(url)
        })
        .catch(() => {
          if (!cancelled) setSrc(getCachedImage(imageId) || '')
        })
      return () => { cancelled = true }
    }

    const cached = getCachedImage(imageId)
    if (cached) {
      setSrc(cached)
      return () => { cancelled = true }
    }
    ensureImageCached(imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => { cancelled = true }
  }, [imageId, maskImageId])

  return (
    <div 
      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg shadow-sm cursor-pointer transition-opacity hover:opacity-90 ${
        maskImageId || commentCount > 0 ? 'border-2 border-blue-500' : 'border border-gray-200 dark:border-white/[0.08]'
      }`}
      onClick={() => setLightboxImageId(imageId, round.inputImageIds, round.prompt)}
    >
      {src ? <img src={src} className="h-full w-full object-cover" alt="" /> : <div className="h-full w-full bg-gray-100 dark:bg-white/[0.04]" />}
      {maskImageId && (
        <span className="absolute left-1 top-1 z-10 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] font-bold leading-none tracking-wider text-white backdrop-blur-sm pointer-events-none">
          MASK
        </span>
      )}
      {commentCount > 0 && <CommentBadge count={commentCount} className={maskImageId ? 'left-1 top-[18px]' : 'left-1 top-1'} />}
      <span className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-semibold text-white backdrop-blur-sm pointer-events-none">
        {imageIndex + 1}
      </span>
    </div>
  )
}

function AgentStreamingCursor() {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400" />
      正在等待 Agent 回复
    </span>
  )
}

function AgentWebSearchInlineStatus({ status }: { status: AgentWebSearchStatus }) {
  return (
    <span className="inline-flex text-sm font-medium text-gray-500 dark:text-gray-400">
      <span className={status.completed ? undefined : 'agent-web-search-running-text'}>{status.text}</span>
    </span>
  )
}

function AgentWebSearchStatusLines({ statuses }: { statuses: AgentWebSearchStatus[] }) {
  if (statuses.length === 0) return null
  return (
    <div className="mb-2 space-y-1">
      {statuses.map((status, index) => (
        <div key={`${status.text}-${index}`}>
          <AgentWebSearchInlineStatus status={status} />
        </div>
      ))}
    </div>
  )
}

const MOBILE_HEADER_PULL_THRESHOLD = 24
const MOBILE_HEADER_PULL_MAX_OFFSET = 48
const MOBILE_HEADER_EDGE_GUARD = 24

export default function AgentWorkspace() {
  const conversations = useVisibleAgentConversations()
  const conversationsLoaded = useStore((s) => s.agentConversationsLoaded)
  const activeConversationId = useStore((s) => s.activeAgentConversationId)
  const createConversation = useStore((s) => s.createAgentConversation)
  const setActiveConversationId = useStore((s) => s.setActiveAgentConversationId)
  const deleteAgentRound = useStore((s) => s.deleteAgentRound)
  const deleteAgentAssistantMessage = useStore((s) => s.deleteAgentAssistantMessage)
  const sidebarCollapsed = useStore((s) => s.agentSidebarCollapsed)
  const setSidebarCollapsed = useStore((s) => s.setAgentSidebarCollapsed)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const setAgentMobileHeaderVisible = useStore((s) => s.setAgentMobileHeaderVisible)
  const appMode = useStore((s) => s.appMode)
  const tasks = useStore((s) => s.tasks)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setPrompt = useStore((s) => s.setPrompt)
  const setInputImages = useStore((s) => s.setInputImages)
  const setMaskDraft = useStore((s) => s.setMaskDraft)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setAppMode = useStore((s) => s.setAppMode)
  const agentScrollToBottomAfterSubmit = useStore((s) => s.settings.agentScrollToBottomAfterSubmit)
  const agentEditingRoundId = useStore((s) => s.agentEditingRoundId)
  const setAgentEditingRoundId = useStore((s) => s.setAgentEditingRoundId)
  const setActiveAgentRoundId = useStore((s) => s.setActiveAgentRoundId)
  const showToast = useStore((s) => s.showToast)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const privacyMode = useStore((s) => Boolean(s.privacyMode))
  const privacyModeEpoch = useStore((s) => s.privacyModeEpoch)
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null
  const [wideHistory, setWideHistory] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const historyVisible = wideHistory ? !sidebarCollapsed : historyDrawerOpen
  const historyToggleRef = useRef<HTMLButtonElement>(null)

  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const [scrollTargetRoundId, setScrollTargetRoundId] = useState<string | null>(null)
  const [pullDownOffset, setPullDownOffset] = useState(0)
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true)
  const touchStartY = useRef(-1)
  const autoScrollStateRef = useRef<{ conversationId: string | null; lastUserMessageSignature: string | null }>({ conversationId: null, lastUserMessageSignature: null })
  const errorCopyPointerDownRef = useRef<{ x: number; y: number } | null>(null)

  const updateIsScrolledToBottom = useCallback(() => {
    const sentinel = bottomSentinelRef.current
    if (appMode !== 'agent' || !sentinel) {
      setIsScrolledToBottom(true)
      return
    }

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    setIsScrolledToBottom(sentinel.getBoundingClientRect().top <= viewportHeight + 24)
  }, [appMode])

  const scrollToAgentBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // 超出可滚动范围时浏览器会停在底部
    getPageScroller().scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior })
  }, [])

  const handleCreateConversation = () => {
    createConversation()
    setHistoryDrawerOpen(false)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touchY = e.touches[0]?.clientY ?? -1
    if (
      appMode !== 'agent' ||
      agentMobileHeaderVisible ||
      getPageScrollTop() > 0 ||
      touchY < MOBILE_HEADER_EDGE_GUARD
    ) {
      touchStartY.current = -1
      setPullDownOffset(0)
      return
    }

    touchStartY.current = touchY
  }

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }
   
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current <= 0 || agentMobileHeaderVisible) return

    const diff = e.touches[0].clientY - touchStartY.current
    if (diff <= 0) {
      setPullDownOffset(0)
      return
    }

    if (e.cancelable) e.preventDefault()
    if (diff >= MOBILE_HEADER_PULL_THRESHOLD) {
      setAgentMobileHeaderVisible(true)
      setPullDownOffset(0)
      touchStartY.current = -1
      return
    }

    setPullDownOffset(Math.min(diff, MOBILE_HEADER_PULL_MAX_OFFSET))
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current > 0 && !agentMobileHeaderVisible) {
      const touchEndY = e.changedTouches[0].clientY
      if (touchEndY - touchStartY.current >= MOBILE_HEADER_PULL_THRESHOLD) setAgentMobileHeaderVisible(true)
    }
    setPullDownOffset(0)
    touchStartY.current = -1
  }

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const handleChange = (e: MediaQueryListEvent) => {
      setWideHistory(e.matches)
      if (e.matches) setHistoryDrawerOpen(false)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (appMode !== 'agent') return

    document.documentElement.classList.add('agent-no-pull-refresh')
    return () => document.documentElement.classList.remove('agent-no-pull-refresh')
  }, [appMode])

  useEffect(() => {
    if (!agentMobileHeaderVisible || appMode !== 'agent') return

    const handleInteract = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('header[data-no-drag-select]')) return
      setAgentMobileHeaderVisible(false)
    }

    document.addEventListener('mousedown', handleInteract, { capture: true })
    document.addEventListener('touchstart', handleInteract, { capture: true })

    return () => {
      document.removeEventListener('mousedown', handleInteract, { capture: true })
      document.removeEventListener('touchstart', handleInteract, { capture: true })
    }
  }, [agentMobileHeaderVisible, appMode, setAgentMobileHeaderVisible])

  // 鼠标没有下拉手势：页面已在顶部时继续向上滚动滚轮展示顶栏，向下滚动收起。
  // 只认页面上的滚动：弹窗、大图和输入栏不在 [data-page-scroll] 里，窄屏的对话列表抽屉在里面，打开时不处理；Ctrl+滚轮与触控板捏合是缩放
  useEffect(() => {
    if (appMode !== 'agent' || historyDrawerOpen || wideHistory) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || !(e.target instanceof Element) || !e.target.closest('[data-page-scroll]')) return
      if (agentMobileHeaderVisible) {
        if (e.deltaY > 0 && !e.target.closest('header[data-no-drag-select]')) setAgentMobileHeaderVisible(false)
        return
      }
      if (e.deltaY < 0 && getPageScrollTop() <= 0) setAgentMobileHeaderVisible(true)
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [agentMobileHeaderVisible, appMode, historyDrawerOpen, setAgentMobileHeaderVisible, wideHistory])

  useEffect(() => {
    if (appMode !== 'agent') return

    let frame = 0

    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateIsScrolledToBottom()
      })
    }

    handleScroll()
    const visualViewport = window.visualViewport
    const scroller = getPageScroller()
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateIsScrolledToBottom)
    visualViewport?.addEventListener('resize', updateIsScrolledToBottom)

    return () => {
      window.cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', updateIsScrolledToBottom)
      visualViewport?.removeEventListener('resize', updateIsScrolledToBottom)
    }
  }, [appMode, updateIsScrolledToBottom])

  useEffect(() => {
    if (appMode !== 'agent') return
    if (!conversationsLoaded) return
    
    if (conversations.length === 0) {
      createConversation()
    } else if (!conversation) {
      const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (latest && latest.messages.length === 0) {
        setActiveConversationId(latest.id)
      } else {
        createConversation()
      }
    }
  }, [appMode, conversationsLoaded, conversations, conversation, createConversation, setActiveConversationId])

  const activeRounds = useMemo(
    () => conversation ? getActiveAgentRounds(conversation) : [],
    [conversation],
  )

  const activeMessages = useMemo(() => {
    if (!conversation) return []
    const messages: AgentMessage[] = []
    for (const round of activeRounds) {
      const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
      if (userMessage) messages.push(userMessage)
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : conversation.messages.find((message) => message.roundId === round.id && message.role === 'assistant')
      if (assistantMessage) messages.push(assistantMessage)
    }
    return messages
  }, [activeRounds, conversation])

  useEffect(() => {
    const conversationId = conversation?.id ?? null
    const lastMessage = activeMessages[activeMessages.length - 1]
    const lastUserMessage = lastMessage?.role === 'assistant' ? activeMessages[activeMessages.length - 2] : lastMessage
    const lastUserMessageSignature = lastUserMessage?.role === 'user'
      ? `${lastUserMessage.id}:${lastUserMessage.createdAt}:${lastUserMessage.content}`
      : null
    const previous = autoScrollStateRef.current
    const conversationChanged = previous.conversationId !== conversationId
    const shouldScroll = appMode === 'agent' &&
      lastUserMessageSignature != null &&
      (conversationChanged || (agentScrollToBottomAfterSubmit && previous.lastUserMessageSignature !== lastUserMessageSignature))

    autoScrollStateRef.current = { conversationId, lastUserMessageSignature }
    if (!shouldScroll) return

    const frame = window.requestAnimationFrame(() => {
      scrollToAgentBottom(conversationChanged ? 'auto' : 'smooth')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeMessages, agentScrollToBottomAfterSubmit, appMode, conversation?.id, scrollToAgentBottom])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateIsScrolledToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [activeMessages, activeRounds, updateIsScrolledToBottom])

  useEffect(() => {
    if (!scrollTargetRoundId) return
    const id = window.requestAnimationFrame(() => {
      messageRefs.current.get(scrollTargetRoundId)?.scrollIntoView({ block: 'center' })
      setScrollTargetRoundId(null)
    })
    return () => window.cancelAnimationFrame(id)
  }, [activeMessages, scrollTargetRoundId])

  const handleSwitchBranch = (round: AgentRound, direction: -1 | 1) => {
    if (!conversation) return
    const siblings = getAgentSiblingRounds(conversation, round)
    if (siblings.length <= 1) return
    const currentIndex = siblings.findIndex((item) => item.id === round.id)
    const nextRound = siblings[(currentIndex + direction + siblings.length) % siblings.length]
    const nextLeafId = getAgentBranchLeafId(conversation, nextRound.id)
    setActiveAgentRoundId(conversation.id, nextLeafId)
    setAgentEditingRoundId(null)
    setScrollTargetRoundId(nextRound.id)
  }

  const handleDeleteMessage = (message: AgentMessage, round: AgentRound) => {
    const isUserMessage = message.role === 'user'
    const conversationId = conversation?.id
    setConfirmDialog({
      title: isUserMessage ? '删除轮次' : '删除消息',
      message: isUserMessage
        ? '确定要删除这轮任务吗？这会删除这条消息和它的输出，后续消息会被保留。'
        : '确定要删除这条消息吗？这会同时删除这条回复生成的图片。',
      awaitAction: true,
      action: async () => {
        if (!conversationId) return true
        try {
          const result = isUserMessage
            ? await deleteAgentRound(conversationId, round.id)
            : await deleteAgentAssistantMessage(conversationId, message.id)
          if (result === 'running') {
            showToast('该轮次仍在生成，请先停止生成后再删除', 'info')
            return true
          }
          if (result === 'not-found') {
            showToast(isUserMessage ? '该轮次已不存在' : '该消息已不存在', 'info')
            return true
          }
          if (result === 'deleted-with-warning') {
            showToast('已删除，但本地存储或图片清理未完成', 'error')
            return true
          }
          showToast(isUserMessage ? '已删除轮次' : '已删除消息', 'success')
          return true
        } catch (err) {
          console.error(err)
          showToast(isUserMessage ? '删除轮次失败' : '删除消息失败', 'error')
          return false
        }
      },
    })
  }

  const handleReuse = (task: TaskRecord) => {
    setConfirmDialog({
      title: '切换到画廊模式？',
      message: '复用参数会应用到画廊输入区。切换到画廊模式后，当前 Agent 对话仍会保留。',
      confirmText: '切换并复用',
      cancelText: '取消',
      action: () => {
        setAppMode('gallery')
        void reuseConfig(task)
      },
    })
  }

  const handleEditRoundMessage = async (round: AgentRound, content: string) => {
    setAgentEditingRoundId(round.id)
    clearMaskDraft()

    const inputImages = await Promise.all(
      round.inputImageIds.map(async (id) => ({
        id,
        dataUrl: await ensureImageCached(id) || '',
      })),
    )
    setInputImages(inputImages)
    const maskTargetImageId = round.maskTargetImageId ?? (round.maskImageId ? round.inputImageIds[0] : null)
    if (maskTargetImageId && round.maskImageId && inputImages.some((img) => img.id === maskTargetImageId)) {
      const maskDataUrl = await ensureImageCached(round.maskImageId)
      if (maskDataUrl) {
        setMaskDraft({
          targetImageId: maskTargetImageId,
          maskDataUrl,
          updatedAt: Date.now(),
        })
      }
    }
    setPrompt(content)
  }

  const handleCopyMessage = async (content: string, successMessage = '提示词已复制', failureMessage = '复制提示词失败') => {
    try {
      await copyTextToClipboard(content)
      showToast(successMessage, 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage(failureMessage, err), 'error')
    }
  }

  const handleErrorCopyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    errorCopyPointerDownRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleErrorCopyClick = (e: ReactMouseEvent<HTMLDivElement>, content: string) => {
    e.stopPropagation()

    const pointerDown = errorCopyPointerDownRef.current
    errorCopyPointerDownRef.current = null
    if (pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 4) return

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      const target = e.currentTarget
      if ((selection.anchorNode && target.contains(selection.anchorNode)) || (selection.focusNode && target.contains(selection.focusNode))) return
    }

    void handleCopyMessage(content, '完整报错已复制', '复制完整报错失败')
  }

  return (
    <main 
      data-agent-workspace 
      className="relative flex min-h-[calc(100dvh-var(--header-height))] overflow-visible"
    >
      {/* Pull Down Indicator */}
      {pullDownOffset > 0 && !agentMobileHeaderVisible && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 flex justify-center items-end pointer-events-none sm:hidden"
          style={{ height: `${pullDownOffset + 10}px`, opacity: pullDownOffset / MOBILE_HEADER_PULL_MAX_OFFSET }}
        >
          <div className="bg-black/60 backdrop-blur-sm text-white rounded-full p-1 mb-2 shadow-lg">
            <ChevronDownIcon className="w-4 h-4" />
          </div>
        </div>
      )}

      {historyVisible && (
        <AgentHistorySidebar
          key={privacyModeEpoch}
          conversations={conversations}
          activeId={activeConversationId}
          loading={!conversationsLoaded}
          drawer={!wideHistory}
          onClose={() => {
            if (wideHistory) setSidebarCollapsed(true)
            else setHistoryDrawerOpen(false)
            window.requestAnimationFrame(() => historyToggleRef.current?.focus({ preventScroll: true }))
          }}
          onCreate={handleCreateConversation}
          onSelect={(id) => {
            setActiveConversationId(id)
            setHistoryDrawerOpen(false)
          }}
        />
      )}

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div
          className="sticky top-[var(--header-height)] z-20 border-b border-gray-200/80 bg-white/90 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90"
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mx-auto flex min-h-12 max-w-4xl items-center gap-2 px-3 sm:px-5">
            {!historyVisible && (
              <button
                ref={historyToggleRef}
                type="button"
                aria-label="展开历史对话"
                aria-expanded={false}
                onClick={() => wideHistory ? setSidebarCollapsed(false) : setHistoryDrawerOpen(true)}
                className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-gray-600 transition-colors hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-gray-300 dark:hover:bg-white/[0.08]"
              >
                <SidebarLeftIcon className="h-4 w-4" />
                历史对话
              </button>
            )}
            <h1 className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {conversation?.title || '新对话'}
            </h1>
            {!historyVisible && (
              <AgentActionButton
                tooltip="新建对话"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
                onClick={handleCreateConversation}
              >
                <PlusIcon className="h-4 w-4" />
              </AgentActionButton>
            )}
          </div>
        </div>

        <div
          className="mx-auto w-full max-w-4xl flex-1 space-y-4 overflow-visible px-3 pb-[calc(var(--input-bar-clearance,12rem)+1.5rem)] pt-5 sm:px-5 sm:pt-7"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {!conversation || activeMessages.length === 0 ? (
            <div className="flex min-h-[min(38vh,22rem)] flex-col items-center justify-center px-3 text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300">
                <SparklesIcon className="h-6 w-6" />
              </span>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {conversationsLoaded ? '开始一段新对话' : '正在读取对话…'}
              </h2>
              {conversationsLoaded && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">发送消息，或添加参考图开始创作。</p>}
            </div>
          ) : (
            (() => {
              const renderedMessages = activeMessages.map((message) => {
                const round = conversation.rounds.find((item) => item.id === message.roundId)
                const isAssistant = message.role === 'assistant'
                const isStreamingAssistant = isAssistant && round?.status === 'running'
                const isEditing = !isAssistant && round?.id === agentEditingRoundId
                const siblingRounds = !isAssistant && round ? getAgentSiblingRounds(conversation, round) : []
                const siblingIndex = round ? siblingRounds.findIndex((item) => item.id === round.id) : -1
                const hasBranches = siblingRounds.length > 1
                const taskSlotsForRound = isAssistant ? getRoundTaskSlots(round ?? null, tasks) : []
                const tasksForRound = taskSlotsForRound.map((slot) => slot.task).filter(Boolean) as TaskRecord[]
                const hasRoundTasks = tasksForRound.length > 0
                const favoriteTasksForRound = tasksForRound.filter((task) => (task.outputImages?.length ?? 0) > 0)
                const hasRoundFavoriteTasks = favoriteTasksForRound.length > 0
                const allRoundTasksFavorited = hasRoundFavoriteTasks && favoriteTasksForRound.every((task) => task.isFavorite)
                const assistantBlocks = isAssistant ? getAgentAssistantBlocks(round ?? null, taskSlotsForRound, tasks, Boolean(message.content.trim())) : []
                const parts = isAssistant ? [] : getPromptMentionParts(message.content, (round?.inputImageIds ?? []).map((id) => ({ id, dataUrl: '' })))
                return (
                  <div key={message.id} className={`flex w-full mb-6 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                    <div
                      ref={(node) => {
                        if (!isAssistant && node) messageRefs.current.set(message.roundId, node)
                        else if (!isAssistant) messageRefs.current.delete(message.roundId)
                      }}
                      className={`group flex max-w-[95%] flex-col md:max-w-[85%] lg:max-w-[75%] ${isAssistant ? 'items-start' : 'items-end'}`}
                    >
                      <article 
                        className={`relative flex min-w-[16rem] max-w-full flex-col rounded-2xl p-4 transition-all duration-200 ${
                        isAssistant 
                          ? 'bg-black/[0.04] dark:bg-white/[0.06] border border-transparent rounded-tl-sm hover:bg-black/[0.07] dark:hover:bg-white/[0.08]' 
                          : `bg-gray-100 dark:bg-[#2A2D31] rounded-tr-sm ${isEditing ? 'ring-2 ring-blue-500/50 dark:ring-blue-400/50' : ''}`
                      }`}
                      >
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <span className="font-medium">
                         <span className={isAssistant ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-700 dark:text-gray-200 font-semibold'}>{isAssistant ? 'Agent' : '用户'}</span> <span className="opacity-60 font-normal ml-1">· 第 {round?.index ?? '?'} 轮</span>
                      </span>
                    </div>
                    
                    {message.role === 'user' && round && round.inputImageIds.length > 0 && (
                      <div className="flex gap-2 mb-3 overflow-x-auto pb-1" onClick={e => e.stopPropagation()}>
                          {round.inputImageIds.map((imgId, imageIndex) => (
                            <ChatImageThumb
                              key={imgId}
                              imageId={imgId}
                              imageIndex={imageIndex}
                              maskImageId={imgId === (round.maskTargetImageId ?? round.inputImageIds[0]) ? round.maskImageId : null}
                              round={round}
                            />
                          ))}
                      </div>
                    )}

                    {round?.status === 'error' && isAssistant && message.content.startsWith('请求失败：') ? (
                      <div
                        data-selectable-text
                        className="-m-2 flex cursor-copy select-text flex-col rounded-xl p-2 transition-colors hover:bg-red-500/[0.1] dark:hover:bg-red-500/[0.16]"
                        title="点击复制完整报错"
                        onPointerDown={handleErrorCopyPointerDown}
                        onClick={(e) => handleErrorCopyClick(e, message.content)}
                      >
                        {(() => {
                          const content = message.content.replace(/^请求失败：/, '');
                          const [mainErr, ...hints] = content.split('\n提示：');
                          return (
                            <>
                              <div className="flex items-start gap-2 text-red-500 dark:text-red-400">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px] mt-[1.5px] flex-shrink-0">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                <div className="whitespace-pre-wrap text-[14px] leading-relaxed break-words font-medium">
                                  {mainErr}
                                </div>
                              </div>
                              {hints.length > 0 && (
                                <div className="pl-[26px] mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-500 dark:text-gray-400 break-words opacity-90">
                                  <span className="font-medium">提示：</span>{hints.join('\n提示：')}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div data-selectable-text className={`text-[15px] leading-relaxed text-gray-800 dark:text-gray-100 ${!isAssistant ? 'select-text' : ''}`}>
                        {isAssistant ? (
                          <>
                            {assistantBlocks.length > 0 ? assistantBlocks.map((block, index) => {
                              if (block.type === 'web-search') return <AgentWebSearchStatusLines key={block.key} statuses={[block.status]} />
                              if (block.type === 'text') return <div key={block.key} className={index > 0 ? 'mt-3' : undefined}><MarkdownRenderer content={block.content ?? message.content} streaming={isStreamingAssistant} /></div>
                              if (block.type === 'batch-params') {
                                return (
                                  <div key={block.key} className={index > 0 ? 'mt-3' : undefined}>
                                    <AgentWebSearchInlineStatus status={block.status} />
                                  </div>
                                )
                              }
                              if (block.type === 'deleted-image-task') {
                                return (
                                  <div key={block.key} className="mt-4 w-full min-w-[16rem] max-w-sm rounded-xl bg-gray-50/50 dark:bg-white/[0.02] border border-dashed border-gray-200 dark:border-white/[0.08] p-4 flex min-h-[120px] flex-col items-center justify-center text-gray-400 dark:text-gray-500" onClick={e => e.stopPropagation()}>
                                    <TrashIcon className="w-6 h-6 mb-2 opacity-50" />
                                    <span className="text-xs">[Image Removed]</span>
                                  </div>
                                )
                              }
                              return (
                                <div key={block.key} className="mt-4 max-w-sm" onClick={e => e.stopPropagation()}>
                                  <TaskCard
                                    task={block.task}
                                    disableSwipe={true}
                                    onClick={() => setDetailTaskId(block.task.id)}
                                    onReuse={() => handleReuse(block.task)}
                                    onEditOutputs={() => editOutputs(block.task)}
                                    onDelete={() => setConfirmDialog({ title: '删除任务', message: '确定要删除这个任务吗？', action: () => removeTask(block.task) })}
                                  />
                                </div>
                              )
                            }) : isStreamingAssistant ? <AgentStreamingCursor /> : null}
                          </>
                        ) : parts.some((part) => part.type === 'mention') ? (
                          <div className="whitespace-pre-wrap break-words">
                            {parts.map((part, i) =>
                              part.type === 'text' ? <span key={i}>{part.text}</span> : <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-100/50 text-blue-700 dark:bg-blue-500/30 dark:text-blue-300 text-xs font-medium mx-0.5 align-baseline">{part.text}</span>
                            )}
                          </div>
                        ) : (
                          <MarkdownRenderer content={parts[0]?.text ?? ''} />
                        )}
                      </div>
                    )}

                      </article>

                    {!isStreamingAssistant && <div className={`mt-2 flex w-full min-w-fit items-center justify-between gap-3 px-1 transition-opacity duration-200 ${isEditing || hasBranches ? 'opacity-100' : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100'}`} onClick={e => e.stopPropagation()}>
                      <div className="flex min-w-0 items-center gap-2">
                        {isEditing && (
                          <div className="inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                            <span className="truncate">正在编辑</span>
                            <AgentActionButton
                              tooltip="取消编辑"
                              className="ml-1 -mr-1 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-500/40 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrompt('');
                                setInputImages([]);
                                clearMaskDraft();
                                setAgentEditingRoundId(null);
                              }}
                            >
                              <CloseIcon className="w-3 h-3" />
                            </AgentActionButton>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-auto text-gray-400">
                        {!isAssistant && round && hasBranches && siblingIndex >= 0 && (
                          <div className="inline-flex items-center text-sm font-bold text-gray-400 dark:text-gray-500 mr-1">
                            <AgentActionButton tooltip="上一分支" className="p-1 rounded-md hover:bg-gray-200/50 dark:hover:bg-white/10 hover:text-gray-800 dark:hover:text-gray-200 transition-colors" onClick={() => handleSwitchBranch(round, -1)}>
                              <ChevronLeftIcon className="w-4 h-4" />
                            </AgentActionButton>
                            <span className="px-1 tabular-nums tracking-widest">{siblingIndex + 1}/{siblingRounds.length}</span>
                            <AgentActionButton tooltip="下一分支" className="p-1 rounded-md hover:bg-gray-200/50 dark:hover:bg-white/10 hover:text-gray-800 dark:hover:text-gray-200 transition-colors" onClick={() => handleSwitchBranch(round, 1)}>
                              <ChevronRightIcon className="w-4 h-4" />
                            </AgentActionButton>
                          </div>
                        )}
                        {isAssistant ? (
                          <>
                            <AgentActionButton tooltip="复制输出文本" className={`p-1.5 rounded-md transition-colors ${message.content.trim() ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/[0.06]' : 'text-gray-300 dark:text-gray-600 opacity-50 cursor-not-allowed'}`} disabled={!message.content.trim()} onClick={() => {
                              void handleCopyMessage(getAgentAssistantCopyContent(message.content, assistantBlocks), '输出文本已复制', '复制输出文本失败');
                            }}>
                              <CopyIcon className="w-4 h-4" />
                            </AgentActionButton>
                            <AgentActionButton tooltip="重新生成" className="p-1.5 rounded-md text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors" onClick={() => {
                              if (conversation && round) void regenerateAgentAssistantMessage(conversation.id, round.id);
                            }}>
                              <RefreshIcon className="w-4 h-4" />
                            </AgentActionButton>
                            {!privacyMode && (
                              <AgentActionButton tooltip={allRoundTasksFavorited ? '编辑收藏夹' : '收藏所有图片'} className={`p-1.5 rounded-md transition-colors ${hasRoundFavoriteTasks ? (allRoundTasksFavorited ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10' : 'text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10') : 'text-gray-300 dark:text-gray-600 opacity-50 cursor-not-allowed'}`} disabled={!hasRoundFavoriteTasks} onClick={() => {
                                if (!hasRoundFavoriteTasks) return;
                                openFavoritePicker(favoriteTasksForRound.map((task) => task.id));
                              }}>
                                <FavoriteIcon className="w-4 h-4" filled={allRoundTasksFavorited} />
                              </AgentActionButton>
                            )}
                            <AgentActionButton tooltip="下载所有图片" className={`p-1.5 rounded-md transition-colors ${hasRoundTasks ? 'text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10' : 'text-gray-300 dark:text-gray-600 opacity-50 cursor-not-allowed'}`} disabled={!hasRoundTasks} onClick={async () => {
                               const imageIds = tasksForRound.flatMap(t => t.outputImages || []);
                               if (imageIds.length === 0) return;
                               try {
                                  const roundIndex = round?.index ?? 0;
                                  const fileNameBase = 'agent-round-' + roundIndex;
                                  const settings = useStore.getState().settings;
                                  const result = settings.zipDownloadRoutes.includes('agent-round-all')
                                    ? await downloadImageEntriesAsZip(getImageZipEntries(imageIds, fileNameBase), fileNameBase)
                                    : await downloadImageIds(imageIds, fileNameBase);
                                 const { successCount, failCount, canceled } = result;
                                 if (canceled) return;
                                 if (successCount === 0) {
                                   useStore.getState().showToast(getDownloadErrorMessage(result.error), 'error');
                                 } else if (failCount > 0) {
                                   useStore.getState().showToast('部分下载失败：成功 ' + successCount + '，失败 ' + failCount, 'error');
                                 } else {
                                   useStore.getState().showToast(withSaveLocation(successCount > 1 ? '下载成功：' + successCount + ' 张图片' : '下载成功', result.location), 'success');
                                 }
                               } catch (err) {
                                 console.error(err);
                                 useStore.getState().showToast(getDownloadErrorMessage(err), 'error');
                               }
                             }}>
                               <DownloadIcon className="w-4 h-4" />
                             </AgentActionButton>
                            <AgentActionButton tooltip="删除消息" className="p-1.5 hover:text-red-600 hover:bg-red-500/[0.1] dark:hover:bg-red-500/[0.16] rounded-md transition-colors" onClick={() => {
                              if (round) handleDeleteMessage(message, round);
                            }}>
                              <TrashIcon className="w-4 h-4" />
                            </AgentActionButton>
                          </>
                        ) : (
                          <>
                            <AgentActionButton tooltip="复制提示词" className="p-1.5 rounded-md hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-white/[0.04] transition-colors" onClick={() => {
                              // 与画廊一致，复制实际发送给接口的文字
                              void handleCopyMessage(round ? replaceAgentPromptImageReferencesForApi(message.content, round, getAgentRoundPath(conversation, round.id), tasks) : message.content);
                            }}>
                              <CopyIcon className="w-4 h-4" />
                            </AgentActionButton>
                            <AgentActionButton tooltip="编辑" className="p-1.5 rounded-md hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-white/[0.04] transition-colors" onClick={() => {
                               if (round) void handleEditRoundMessage(round, message.content);
                            }}>
                              <EditIcon className="w-4 h-4" />
                            </AgentActionButton>
                            <AgentActionButton tooltip="删除" className="p-1.5 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/[0.1] dark:hover:bg-red-500/[0.16] rounded-md transition-colors" onClick={() => {
                              if (round) handleDeleteMessage(message, round);
                            }}>
                              <TrashIcon className="w-4 h-4" />
                            </AgentActionButton>
                          </>
                        )}
                      </div>
                    </div>}
                    </div>
                </div>
                )
              })

              const runningRounds = activeRounds.filter((round) =>
                round.status === 'running' &&
                !conversation.messages.some((message) => message.roundId === round.id && message.role === 'assistant'),
              )

              return (
                <>
                  {renderedMessages}
                  {runningRounds.map((round) => (
                    <div key={`running-${round.id}`} className="flex w-full justify-start mb-6">
                      <article className="flex min-w-[16rem] max-w-[95%] flex-col rounded-2xl rounded-tl-sm border border-transparent bg-black/[0.04] p-4 dark:bg-white/[0.06] md:max-w-[85%] lg:max-w-[75%]">
                        <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                          <span className="text-blue-600 dark:text-blue-400 font-semibold">Agent</span> <span className="ml-1 font-normal opacity-60">· 第 {round.index} 轮</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                          <span className="inline-flex items-center gap-1.5">
                            <span>正在生成回复</span>
                            <span className="flex gap-1">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                            </span>
                          </span>
                        </div>
                      </article>
                    </div>
                  ))}
                </>
              )
            })()
          )}
          <div ref={bottomSentinelRef} aria-hidden="true" />
        </div>

        <button
          onClick={() => scrollToAgentBottom()}
          className={`fixed bottom-[calc(var(--input-bar-clearance,12rem)+1.5rem)] left-[calc((100%-var(--page-scrollbar-width))/2)] -translate-x-1/2 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 backdrop-blur shadow-[0_2px_12px_rgba(0,0,0,0.1)] border border-gray-200/50 text-gray-500 transition-all duration-300 hover:bg-gray-50 hover:text-gray-800 dark:border-white/[0.08] dark:bg-gray-800/90 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${
            !isScrolledToBottom && activeMessages.length > 0 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
          }`}
          aria-label="滚动到底部"
        >
          <ArrowDownIcon className="h-5 w-5" />
        </button>
      </section>
    </main>
  )
}
