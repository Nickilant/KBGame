import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })
const ALL_REACTIONS = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😍','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤗','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌']
const AVATAR_SIZE = 64
const AVATAR_RADIUS = 32
const toApiMediaUrl = (url) => (url && /^https?:\/\//i.test(url) ? url : `${api.defaults.baseURL}${url || ''}`)

const createDefaultAvatar = () => {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_RADIUS, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL('image/png')
}

export function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')

  const [activeTab, setActiveTab] = useState('profile')
  const [me, setMe] = useState(null)
  const [posts, setPosts] = useState([])
  const [channels, setChannels] = useState([])
  const [selectedChannelId, setSelectedChannelId] = useState(null)
  const [newPostText, setNewPostText] = useState('')
  const [postMedia, setPostMedia] = useState([])
  const [uploading, setUploading] = useState(false)
  const [hoveredPostId, setHoveredPostId] = useState(null)
  const [postContextMenu, setPostContextMenu] = useState({ open: false, x: 0, y: 0, postId: null })
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelAvatar, setNewChannelAvatar] = useState('')
  const fileInputRef = useRef(null)

  const [rooms, setRooms] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [chat, setChat] = useState([])
  const [message, setMessage] = useState('')
  const [chatMedia, setChatMedia] = useState([])
  const [chatError, setChatError] = useState('')
  const [slowmodeNotice, setSlowmodeNotice] = useState('')
  const wsRef = useRef(null)
  const syncWsRef = useRef(null)
  const slowmodeTimerRef = useRef(null)
  const [showRoomModal, setShowRoomModal] = useState(false)
  const chatFileInputRef = useRef(null)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomAvatar, setNewRoomAvatar] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [roomMembers, setRoomMembers] = useState([])
  const [roomNameDraft, setRoomNameDraft] = useState('')
  const chatSettingsAvatarInputRef = useRef(null)
  const [imageViewer, setImageViewer] = useState({ open: false, images: [], index: 0 })

  const [commentModalPost, setCommentModalPost] = useState(null)
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [showCommentEmoji, setShowCommentEmoji] = useState(false)
  const commentsRef = useRef(null)
  const avatarCanvasRef = useRef(null)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [avatarTool, setAvatarTool] = useState('pencil')
  const [avatarColor, setAvatarColor] = useState('#121212')
  const avatarColorInputRef = useRef(null)
  const [isAvatarDrawing, setIsAvatarDrawing] = useState(false)
  const [profileAvatarPixels, setProfileAvatarPixels] = useState(localStorage.getItem('profile_avatar_pixels') || '')
  const [equippedItems, setEquippedItems] = useState({
    weapon: null,
    shield: null,
    helmet: null,
    armor: null,
    boots: null,
    amulet: null,
    ring1: null,
    ring2: null,
  })
  const [inventory, setInventory] = useState([])
  const [uniqueAbilities] = useState(Array(10).fill(null))
  const [adminUsers, setAdminUsers] = useState([])
  const [adminItems, setAdminItems] = useState([])
  const [adminUserDrafts, setAdminUserDrafts] = useState({})
  const [newBoss, setNewBoss] = useState({ name: '', hp: 1000, attack: 40, defense: 15 })
  const [selectedGrantUserId, setSelectedGrantUserId] = useState('')
  const [grantQuantity, setGrantQuantity] = useState(1)
  const adminItemImageInputRef = useRef(null)
  const [adminItemError, setAdminItemError] = useState('')
  const [newItem, setNewItem] = useState({
    image_url: '',
    slot: 'weapon',
    name: '',
    description: '',
    hp_bonus: 0,
    attack_bonus: 0,
    defense_bonus: 0,
    accuracy_bonus: 0,
    attack_speed_bonus: 0,
    unique_skill: '',
  })

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const isBoss = me?.role === 'boss'
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId)
  const canManageSelectedRoom = !!selectedRoom?.can_manage
  const isAdmin = me?.role === 'admin' || me?.role === 'master_admin'
  const level = me?.level || 1
  const currentXp = 0
  const xpToNext = 100
  const equippedItemsList = useMemo(() => Object.values(equippedItems).filter(Boolean), [equippedItems])
  const totalBonuses = useMemo(() => equippedItemsList.reduce((acc, item) => {
    Object.entries(item.bonuses || {}).forEach(([key, value]) => {
      acc[key] = (acc[key] || 0) + value
    })
    return acc
  }, {}), [equippedItemsList])
  const profileStats = {
    hp: 100 + (totalBonuses.hp || 0),
    damage: 20 + (totalBonuses.damage || 0),
    defense: 5 + (totalBonuses.defense || 0),
    accuracy: 40 + (totalBonuses.accuracy || 0),
    speed: 1 + ((totalBonuses.speed || 0) / 100),
  }

  const defaultAvatarImage = useMemo(() => createDefaultAvatar(), [])
  const addMediaAttachment = async (files, setter) => {
    const uploaded = await Promise.all(Array.from(files).map((file) => uploadMedia(file)))
    setter((prev) => [...prev, ...uploaded.filter((item) => item?.type === 'image')])
  }

  const removeMediaAttachment = (index, setter) => {
    setter((prev) => prev.filter((_, idx) => idx !== index))
  }

  const chatAvatarLetter = (name) => (name || '?').trim().slice(0, 1).toUpperCase()

  const openImageViewer = (images, startIndex = 0) => {
    if (!images?.length) return
    setImageViewer({ open: true, images, index: Math.max(0, Math.min(startIndex, images.length - 1)) })
  }

  const closeImageViewer = () => setImageViewer({ open: false, images: [], index: 0 })

  const switchViewerImage = (direction) => {
    setImageViewer((prev) => {
      if (!prev.open || prev.images.length < 2) return prev
      const next = (prev.index + direction + prev.images.length) % prev.images.length
      return { ...prev, index: next }
    })
  }

  const drawAvatarCanvas = (source) => {
    const canvas = avatarCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
      ctx.drawImage(img, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    }
    img.src = source || defaultAvatarImage
  }

  const isInsideAvatarBall = (x, y) => {
    const dx = x - (AVATAR_SIZE / 2)
    const dy = y - (AVATAR_SIZE / 2)
    return (dx * dx) + (dy * dy) <= ((AVATAR_RADIUS + 0.75) * (AVATAR_RADIUS + 0.75))
  }

  const paintAvatarAt = (event) => {
    const canvas = avatarCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * AVATAR_SIZE)
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * AVATAR_SIZE)

    if (!isInsideAvatarBall(x, y)) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (avatarTool === 'eraser') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(x, y, 1, 1)
      return
    }

    ctx.fillStyle = avatarColor
    ctx.fillRect(x, y, 1, 1)
  }

  const equipmentSlots = [
    { key: 'weapon', label: 'Оружие', accepted: 'weapon' },
    { key: 'shield', label: 'Щит', accepted: 'shield' },
    { key: 'helmet', label: 'Шлем', accepted: 'helmet' },
    { key: 'armor', label: 'Броня', accepted: 'armor' },
    { key: 'boots', label: 'Обувь', accepted: 'boots' },
    { key: 'amulet', label: 'Амулет', accepted: 'amulet' },
    { key: 'ring1', label: 'Кольцо I', accepted: 'ring' },
    { key: 'ring2', label: 'Кольцо II', accepted: 'ring' },
  ]

  const loadChannels = async () => {
    const { data } = await api.get('/api/channels', { headers })
    setChannels(data)
    setSelectedChannelId((prev) => {
      if (!data.length) return null
      if (prev && data.some((c) => c.id === prev)) return prev
      return prev == null ? data[0].id : prev
    })
  }

  const loadFeed = async (scrollToLastRead = false) => {
    const url = selectedChannelId ? `/api/news?channel_id=${selectedChannelId}` : '/api/news'
    const [feedResp, lastReadResp] = await Promise.all([
      api.get(url, { headers }),
      api.get('/api/news/last-read', { headers }),
    ])
    const asc = [...feedResp.data].reverse()
    setPosts(asc)
    if (scrollToLastRead && lastReadResp.data.last_read_post_id) {
      setTimeout(() => document.getElementById(`post-${lastReadResp.data.last_read_post_id}`)?.scrollIntoView({ block: 'center' }), 150)
    }
  }

  const loadRooms = async () => {
    const { data: roomData } = await api.get('/api/rooms', { headers })
    setRooms(roomData)
    setSelectedRoomId((prev) => {
      if (!roomData.length) return null
      if (prev && roomData.some((r) => r.id === prev)) return prev
      return prev == null ? ((roomData.find((r) => r.name === 'global') || roomData[0]).id) : prev
    })
  }

  const loadInventory = async () => {
    const inventoryResp = await api.get('/api/inventory', { headers })
    setInventory(inventoryResp.data)
  }

  const loadBase = async () => {
    const meResp = await api.get('/api/me', { headers })
    setMe(meResp.data)
    await loadInventory()
    await loadChannels()
    await loadRooms()
  }

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    loadBase()
  }, [token])


  useEffect(() => {
    if (profileAvatarPixels) return
    setProfileAvatarPixels(defaultAvatarImage)
    localStorage.setItem('profile_avatar_pixels', defaultAvatarImage)
  }, [profileAvatarPixels, defaultAvatarImage])

  useEffect(() => {
    if (!me?.avatar_data) return
    setProfileAvatarPixels(me.avatar_data)
    localStorage.setItem('profile_avatar_pixels', me.avatar_data)
  }, [me?.avatar_data])

  useEffect(() => {
    if (!avatarModalOpen) return
    drawAvatarCanvas(profileAvatarPixels || defaultAvatarImage)
  }, [avatarModalOpen, profileAvatarPixels, defaultAvatarImage])

  useEffect(() => {
    if (!token || selectedChannelId == null) return
    loadFeed(true)
  }, [token, selectedChannelId])

  useEffect(() => {
    if (!token || !selectedRoomId) return
    api.get(`/api/chat/messages/${selectedRoomId}`, { headers }).then((r) => setChat(r.data))
  }, [token, selectedRoomId, headers])


  useEffect(() => () => {
    if (slowmodeTimerRef.current) clearTimeout(slowmodeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!token || !selectedRoomId) return
    api.get(`/api/rooms/${selectedRoomId}/members`, { headers }).then((r) => setRoomMembers(r.data)).catch(() => setRoomMembers([]))
  }, [token, selectedRoomId, headers])

  useEffect(() => {
    setRoomNameDraft(selectedRoom?.name || '')
  }, [selectedRoom?.id, selectedRoom?.name])


  useEffect(() => {
    if (!postContextMenu.open) return
    const close = () => setPostContextMenu({ open: false, x: 0, y: 0, postId: null })
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [postContextMenu.open])
  useEffect(() => {
    if (!imageViewer.open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeImageViewer()
      if (event.key === 'ArrowLeft') switchViewerImage(-1)
      if (event.key === 'ArrowRight') switchViewerImage(1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [imageViewer.open])

  useEffect(() => {
    if (!token || !selectedRoomId) return
    const wsBase = api.defaults.baseURL.replace('http://', 'ws://').replace('https://', 'wss://')
    const ws = new WebSocket(`${wsBase}/ws/room-${selectedRoomId}`)
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'message_created' && payload.room_id === selectedRoomId) {
          setChat((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]))
        }
        if (payload.type === 'message_deleted' && payload.room_id === selectedRoomId) {
          setChat((prev) => prev.filter((m) => m.id !== payload.message_id))
        }
      } catch {
        // noop
      }
    }
    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [token, selectedRoomId])


  useEffect(() => {
    if (!token) return
    const intervalId = setInterval(async () => {
      try {
        await Promise.all([loadChannels(), loadRooms()])
      } catch {
        // noop
      }
    }, 3000)
    return () => clearInterval(intervalId)
  }, [token, headers])

  useEffect(() => {
    if (!token) return
    const wsBase = api.defaults.baseURL.replace('http://', 'ws://').replace('https://', 'wss://')
    const ws = new WebSocket(`${wsBase}/ws/system-sync`)
    syncWsRef.current = ws
    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'channels_changed') {
          await loadChannels()
        }
        if (payload.type === 'rooms_changed') {
          await loadRooms()
        }
        if (payload.type === 'posts_changed') {
          await loadChannels()
          await loadFeed(false)
        }
      } catch {
        // noop
      }
    }
    return () => {
      ws.close()
      syncWsRef.current = null
    }
  }, [token, headers])

  const login = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    setAuthError('')
    try {
      const { data } = await api.post('/api/auth/login', { username: f.get('username'), password: f.get('password') })
      setToken(data.access_token)
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Ошибка входа')
    }
  }

  const register = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    const pass = (f.get('password') || '').toString()
    const repass = (f.get('confirmPassword') || '').toString()
    setAuthError('')
    if (pass !== repass) return setAuthError('Пароли не совпадают')
    try {
      await api.post('/api/auth/register', { username: f.get('username'), password: pass })
      setAuthMode('login')
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Ошибка регистрации')
    }
  }

  const uploadMedia = async (file) => {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const { data } = await api.post('/api/uploads/media', body, { headers: { ...headers, 'Content-Type': 'multipart/form-data' } })
      return data
    } finally {
      setUploading(false)
    }
  }

  const createPost = async (e) => {
    e.preventDefault()
    if (!newPostText.trim() && postMedia.length === 0) return
    await api.post('/api/news', {
      title: newPostText.slice(0, 60) || 'Новый пост',
      content: newPostText || ' ',
      image_url: postMedia[0]?.type === 'image' ? postMedia[0].url : '',
      video_url: postMedia[0]?.type === 'video' ? postMedia[0].url : '',
      media_urls: postMedia.filter((m) => m.type === 'image').map((m) => m.url),
      audio_url: '',
      channel_id: selectedChannelId,
    }, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'posts_changed' }))
    setNewPostText('')
    setPostMedia([])
    await Promise.all([loadFeed(false), loadChannels()])
  }

  const createChannel = async () => {
    if (!newChannelName.trim()) return
    await api.post('/api/channels', { name: newChannelName, avatar_url: newChannelAvatar }, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'channels_changed' }))
    setNewChannelName('')
    setNewChannelAvatar('')
    setShowChannelModal(false)
    await loadChannels()
  }

  const deleteChannel = async (channelId) => {
    await api.delete(`/api/channels/${channelId}`, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'channels_changed' }))
    await loadChannels()
    if (selectedChannelId === channelId) {
      setSelectedChannelId(null)
      setPosts([])
    }
  }

  const react = async (id, emoji) => {
    await api.post(`/api/news/${id}/reactions`, { emoji }, { headers })
    await Promise.all([loadFeed(false), loadChannels()])
  }

  const deletePost = async (id) => {
    await api.delete(`/api/news/${id}`, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'posts_changed' }))
    await Promise.all([loadFeed(false), loadChannels()])
  }

  const markRead = async (id) => {
    await api.post(`/api/news/${id}/read`, {}, { headers })
    await loadChannels()
  }

  const openComments = async (post) => {
    setCommentModalPost(post)
    const { data } = await api.get(`/api/news/${post.id}/comments`, { headers })
    setComments(data)
    setCommentDraft('')
    setShowCommentEmoji(false)
    setTimeout(() => commentsRef.current?.scrollTo({ top: 0 }), 0)
  }

  const sendComment = async () => {
    if (!commentModalPost || !commentDraft.trim()) return
    await api.post(`/api/news/${commentModalPost.id}/comments`, { content: commentDraft }, { headers })
    const { data } = await api.get(`/api/news/${commentModalPost.id}/comments`, { headers })
    setComments(data)
    setPosts((prev) => prev.map((post) => (post.id === commentModalPost.id ? { ...post, comment_count: data.length } : post)))
    await loadChannels()
    setCommentDraft('')
  }

  const sendMessage = async () => {
    if (!selectedRoomId || (!message.trim() && chatMedia.length === 0)) return
    setChatError('')
    try {
      const { data } = await api.post('/api/chat/messages', {
        room_id: selectedRoomId,
        content: message,
        media_url: chatMedia[0]?.url || '',
        media_type: chatMedia.length ? 'image' : '',
        media_urls: chatMedia.map((m) => m.url),
      }, { headers })
      setChat((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'message_created', room_id: selectedRoomId, message: data }))
      }
      setMessage('')
      setChatMedia([])
      setSlowmodeNotice('')
    } catch (err) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'object' && detail?.code === 'SLOWMODE') {
        const seconds = Number(detail.retry_after_seconds || 0)
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        const fmt = mins > 0 ? `${mins}м ${secs}с` : `${secs}с`
        setSlowmodeNotice(`В чате установлен слоумод, вы сможете отправить сообщение через ${fmt}`)
        if (slowmodeTimerRef.current) clearTimeout(slowmodeTimerRef.current)
        slowmodeTimerRef.current = setTimeout(() => setSlowmodeNotice(''), 2500)
      } else {
        setChatError(detail || 'Не удалось отправить сообщение')
      }
    }
  }

  const createRoom = async () => {
    if (!newRoomName.trim()) return
    await api.post('/api/rooms', { name: newRoomName, avatar_url: newRoomAvatar }, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'rooms_changed' }))
    setNewRoomName('')
    setNewRoomAvatar('')
    setShowRoomModal(false)
    await loadRooms()
  }

  const deleteRoom = async (roomId) => {
    await api.delete(`/api/rooms/${roomId}`, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'rooms_changed' }))
    await loadRooms()
  }

  const patchRoomSettings = async (changes) => {
    if (!selectedRoomId) return
    const { data } = await api.patch(`/api/rooms/${selectedRoomId}`, changes, { headers })
    setRooms((prev) => prev.map((r) => (r.id === data.id ? data : r)))
  }

  const joinByCode = async () => {
    if (!joinCodeInput.trim()) return
    await api.get(`/api/rooms/join/${joinCodeInput.trim().toUpperCase()}`, { headers })
    if (syncWsRef.current?.readyState === WebSocket.OPEN) syncWsRef.current.send(JSON.stringify({ type: 'rooms_changed' }))
    setJoinCodeInput('')
    await loadRooms()
  }

  const removeMessage = async (id) => {
    await api.delete(`/api/chat/messages/${id}`, { headers })
    setChat((prev) => prev.filter((m) => m.id !== id))
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message_deleted', room_id: selectedRoomId, message_id: id }))
    }
  }

  const saveAvatarDrawing = async () => {
    const canvas = avatarCanvasRef.current
    if (!canvas) return
    const snapshot = canvas.toDataURL('image/png')
    setProfileAvatarPixels(snapshot)
    localStorage.setItem('profile_avatar_pixels', snapshot)
    try {
      const { data } = await api.patch('/api/me/avatar', { avatar_data: snapshot }, { headers })
      setMe((prev) => (prev ? { ...prev, avatar_data: data.avatar_data || snapshot } : prev))
    } catch {
      // noop
    }
    setAvatarModalOpen(false)
  }

  const resetAvatarDrawing = () => {
    setProfileAvatarPixels(defaultAvatarImage)
    localStorage.setItem('profile_avatar_pixels', defaultAvatarImage)
    drawAvatarCanvas(defaultAvatarImage)
  }

  const equipItem = (item) => {
    const normalized = {
      ...item,
      bonuses: {
        hp: item.hp_bonus || item.bonuses?.hp || 0,
        damage: item.attack_bonus || item.bonuses?.damage || 0,
        defense: item.defense_bonus || item.bonuses?.defense || 0,
        accuracy: item.accuracy_bonus || item.bonuses?.accuracy || 0,
        speed: item.attack_speed_bonus || item.bonuses?.speed || 0,
      },
    }
    const targetSlot = item.slot === 'ring'
      ? (!equippedItems.ring1 ? 'ring1' : (!equippedItems.ring2 ? 'ring2' : 'ring1'))
      : (item.slot || 'weapon')

    setEquippedItems((prev) => {
      const previousInSlot = prev[targetSlot]
      const nextEquipped = { ...prev, [targetSlot]: normalized }
      if (previousInSlot) {
        setInventory((invPrev) => [...invPrev, previousInSlot])
      }
      return nextEquipped
    })
    setInventory((prev) => prev.filter((invItem) => invItem.inventory_entry_id !== item.inventory_entry_id))
  }

  const unequipItem = (slotKey) => {
    const item = equippedItems[slotKey]
    if (!item) return
    setInventory((prev) => [...prev, item])
    setEquippedItems((prev) => ({ ...prev, [slotKey]: null }))
  }

  const loadAdminPanel = async () => {
    const [usersResult, itemsResult] = await Promise.allSettled([
      api.get('/api/master-admin/users', { headers }),
      api.get('/api/master-admin/items', { headers }),
    ])

    const usersData = usersResult.status === 'fulfilled' ? usersResult.value.data : []
    const itemsData = itemsResult.status === 'fulfilled' ? itemsResult.value.data : []

    setAdminUsers(usersData)
    setAdminItems(itemsData)
    setAdminUserDrafts((prev) => {
      const next = { ...prev }
      usersData.forEach((u) => {
        next[u.id] = {
          role: prev[u.id]?.role ?? u.role,
          hp: prev[u.id]?.hp ?? u.hp,
          attack: prev[u.id]?.attack ?? u.attack,
          defense: prev[u.id]?.defense ?? u.defense,
          level: prev[u.id]?.level ?? u.level,
          gold: prev[u.id]?.gold ?? u.gold,
        }
      })
      return next
    })
    if (!selectedGrantUserId && usersData.length) {
      setSelectedGrantUserId(String(usersData[0].id))
    }
  }

  const createAdminItem = async () => {
    setAdminItemError('')
    if (!newItem.image_url) {
      setAdminItemError('Сначала загрузите картинку предмета')
      return
    }
    try {
      await api.post('/api/master-admin/items', {
        ...newItem,
        unique_skill: (newItem.unique_skill || '').trim() || null,
        attack_speed_bonus: Number(newItem.attack_speed_bonus || 0),
        hp_bonus: Number(newItem.hp_bonus || 0),
        attack_bonus: Number(newItem.attack_bonus || 0),
        defense_bonus: Number(newItem.defense_bonus || 0),
        accuracy_bonus: Number(newItem.accuracy_bonus || 0),
      }, { headers })
      setNewItem({ image_url: '', slot: 'weapon', name: '', description: '', hp_bonus: 0, attack_bonus: 0, defense_bonus: 0, accuracy_bonus: 0, attack_speed_bonus: 0, unique_skill: '' })
      await loadAdminPanel()
    } catch (err) {
      setAdminItemError(err.response?.data?.detail || 'Не удалось создать предмет')
    }
  }

  const grantItemToUser = async (itemId) => {
    if (!selectedGrantUserId) return
    await api.post(`/api/master-admin/items/${itemId}/grant`, {
      user_id: Number(selectedGrantUserId),
      quantity: Math.max(1, Number(grantQuantity || 1)),
    }, { headers })
    await loadAdminPanel()
  }

  const updateAdminUserDraft = (userId, field, value) => {
    setAdminUserDrafts((prev) => ({
      ...prev,
      [userId]: {
        role: prev[userId]?.role ?? 'player',
        hp: prev[userId]?.hp ?? 100,
        attack: prev[userId]?.attack ?? 20,
        defense: prev[userId]?.defense ?? 5,
        level: prev[userId]?.level ?? 1,
        gold: prev[userId]?.gold ?? 0,
        ...prev[userId],
        [field]: value,
      },
    }))
  }

  const applyAdminUserChanges = async (userId) => {
    const draft = adminUserDrafts[userId]
    if (!draft) return
    await api.patch(`/api/master-admin/users/${userId}/role`, { role: draft.role }, { headers })
    await api.patch(`/api/master-admin/users/${userId}/stats`, {
      hp: Number(draft.hp),
      attack: Number(draft.attack),
      defense: Number(draft.defense),
      level: Number(draft.level),
      gold: Number(draft.gold),
    }, { headers })
    await loadAdminPanel()
  }

  const toggleUserBan = async (userId, isBanned) => {
    await api.patch(`/api/master-admin/users/${userId}/ban`, { is_banned: !isBanned }, { headers })
    await loadAdminPanel()
  }

  const createBossFromAdmin = async () => {
    if (!newBoss.name.trim()) return
    await api.post('/api/master-admin/bosses', {
      name: newBoss.name.trim(),
      hp: Number(newBoss.hp),
      attack: Number(newBoss.attack),
      defense: Number(newBoss.defense),
      abilities: [],
    }, { headers })
    setNewBoss({ name: '', hp: 1000, attack: 40, defense: 15 })
  }

  useEffect(() => {
    if (!token || !isAdmin) return
    loadAdminPanel().catch(() => {
      // noop
    })
  }, [token, isAdmin])

  useEffect(() => {
    if (!token || activeTab !== 'profile') return

    const refreshInventory = () => {
      loadInventory().catch(() => {
        // noop
      })
    }

    refreshInventory()
    const inventoryPoll = setInterval(refreshInventory, 10000)
    window.addEventListener('focus', refreshInventory)

    return () => {
      clearInterval(inventoryPoll)
      window.removeEventListener('focus', refreshInventory)
    }
  }, [token, activeTab])


  if (!token) {
    return <div className="auth-page"><form className="auth-card card" onSubmit={authMode === 'login' ? login : register}><h1>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h1>{authError && <div className="auth-error">{authError}</div>}<input name="username" placeholder="Логин" required /><input name="password" type="password" placeholder="Пароль" required />{authMode === 'register' && <input name="confirmPassword" type="password" placeholder="Повторите пароль" required />}<button type="submit">{authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button><button type="button" className="link-btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Вход'}</button></form></div>
  }

  return (
    <div className="app-shell">
      <header className="topbar card">
        <h1>KB Raid Arena</h1>
        <nav className="tabs">
          <button onClick={() => setActiveTab('profile')} className={activeTab === 'profile' ? 'tab active' : 'tab'}>Профиль</button>
          <button onClick={() => setActiveTab('boss')} className={activeTab === 'boss' ? 'tab active' : 'tab'}>БоссБатл</button>
          <button onClick={() => setActiveTab('feed')} className={activeTab === 'feed' ? 'tab active' : 'tab'}>Лента</button>
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'tab active' : 'tab'}>Чат</button>
          {isAdmin && <button onClick={() => setActiveTab('admin')} className={activeTab === 'admin' ? 'tab active' : 'tab'}>Админка</button>}
        </nav>
      </header>

      {activeTab === 'feed' && (
        <main className="feed-page card">
          <aside className="channels-sidebar">
            <div className="channels-header">Каналы {isBoss && <><span>|</span><button onClick={() => setShowChannelModal(true)} className="add-channel-btn">+</button></>}</div>
            <div className="channels-list">{channels.length === 0 ? <div className="channels-empty">Каналов пока нет</div> : channels.map((c) => <button key={c.id} className={`channel-item ${selectedChannelId === c.id ? 'active' : ''}`} onClick={() => setSelectedChannelId(c.id)}><img src={c.avatar_url ? `${api.defaults.baseURL}${c.avatar_url}` : 'https://placehold.co/40x40/1f2433/ffffff?text=%23'} alt={c.name} /><div className="channel-main"><span>{c.name}</span>{c.unread_count > 0 && <small>{c.unread_count}</small>}</div>{isBoss && <span className="channel-actions"><span className="channel-v-sep">|</span><span className="delete-channel-btn" onClick={(e) => { e.stopPropagation(); deleteChannel(c.id) }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); deleteChannel(c.id) } }}>✕</span></span>}</button>)}</div>
          </aside>

          <section className="posts-column">
            <section className="posts-scroll-block">
              {posts.map((p) => {
                const postImages = (p.media_urls?.length ? p.media_urls : (p.image_url ? [p.image_url] : []))
                return (
                <div key={p.id} className="post-shell" onMouseEnter={() => setHoveredPostId(p.id)} onMouseLeave={() => setHoveredPostId(null)} onContextMenu={(e) => { if (!isBoss) return; e.preventDefault(); setPostContextMenu({ open: true, x: e.clientX, y: e.clientY, postId: p.id }) }}>
                  <article id={`post-${p.id}`} className="tg-post card" onClick={() => markRead(p.id)}>
                    {postImages.length > 0 && <div className="post-media-grid">{postImages.map((url, idx) => <button type="button" key={`${url}-${idx}`} className="post-media-button" onClick={(e) => { e.stopPropagation(); openImageViewer(postImages, idx) }}><img className="post-image" src={`${api.defaults.baseURL}${url}`} alt="media" /></button>)}</div>}
                    {p.video_url && <video className="post-video" controls src={`${api.defaults.baseURL}${p.video_url}`} />}
                    <div className="post-body">
                      <p className="post-text">{p.content}</p>
                      <div className="post-meta"><span className="views-right">Просмотры: {p.views}</span></div>
                      <button className="comments-full" onClick={(e) => { e.stopPropagation(); openComments(p) }}><span>{p.comment_count > 0 ? `Комментариев ${p.comment_count}` : 'Прокомментировать'}</span><span className="row-arrow">›</span></button>
                    </div>
                  </article>

                  {hoveredPostId === p.id && <div className="hover-reactions-vertical">{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}</div>}
                  <div className="reactions-summary under-post">{Object.entries(p.reactions || {}).map(([emoji, count]) => <button className={`reaction-capsule ${p.my_reaction === emoji ? 'mine' : ''}`} key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji} {count}</button>)}</div>
                </div>
              )})}
            </section>

            {isBoss && <form className="post-input-wrap" onSubmit={createPost}>{postMedia.length > 0 && <div className="composer-preview thumbs">{postMedia.map((m, idx) => <div key={`${m.url}-${idx}`} className="preview-thumb-wrap"><img src={`${api.defaults.baseURL}${m.url}`} alt="preview" /><button type="button" className="preview-remove" onClick={() => removeMediaAttachment(idx, setPostMedia)}>✕</button></div>)}</div>}<div className="post-input-row"><button type="button" className="clip-btn" onClick={() => fileInputRef.current?.click()}>📎</button><span className="input-v-sep" aria-hidden="true">|</span><input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple accept="image/*" onChange={async (e) => { if (e.target.files?.length) await addMediaAttachment(e.target.files, setPostMedia); e.target.value = '' }} /><input value={newPostText} onChange={(e) => setNewPostText(e.target.value)} placeholder="Текст поста" /><button type="submit" className="post-send-btn" disabled={uploading}>{uploading ? '…' : '›'}</button></div></form>}
          </section>
          {postContextMenu.open && <div className="post-context-menu" style={{ left: postContextMenu.x, top: postContextMenu.y }} onClick={(e) => e.stopPropagation()}><button type="button" className="post-context-delete" onClick={async () => { if (!postContextMenu.postId) return; await deletePost(postContextMenu.postId); setPostContextMenu({ open: false, x: 0, y: 0, postId: null }) }}>Удалить пост</button></div>}
        </main>
      )}

      {activeTab === 'chat' && (
        <main className="chat-layout card">
          <aside className="channels-sidebar">
            <div className="channels-header">Чаты <span>|</span><button onClick={() => setShowRoomModal(true)} className="add-channel-btn">+</button></div>
            <div className="chat-code-top"><div className="join-input-wrap"><input value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} placeholder="Вступить в чат по коду" /><button className="join-inline-btn" onClick={joinByCode}>✓</button></div></div>
            <div className="channels-list">
              {rooms.map((r) => (
                <button key={r.id} className={`channel-item ${selectedRoomId === r.id ? 'active' : ''}`} onClick={() => setSelectedRoomId(r.id)}>
                  <img src={r.avatar_url ? `${api.defaults.baseURL}${r.avatar_url}` : 'https://placehold.co/40x40/1f2433/ffffff?text=C'} alt={r.name} />
                  <div className="channel-main"><span>{r.name}</span>{r.is_main && <small>main</small>}</div>
                </button>
              ))}
            </div>
          </aside>

          <section className="posts-column">
            <section className="posts-scroll-block chat-box no-radius">
              {chat.map((m, i) => {
                const mediaItems = (m.media_urls?.length ? m.media_urls : (m.media_url ? [m.media_url] : []))
                return <div key={m.id || i} className="chat-message">{m.avatar_data ? <img src={m.avatar_data} alt="avatar" className="chat-user-avatar-image" /> : <span className="chat-user-avatar" style={{ backgroundColor: m.nickname_color || '#50608a' }}>{chatAvatarLetter(m.username || `#${m.user_id}`)}</span>}<b style={{ color: m.nickname_color || "#cfd8ff" }}>{m.username || `#${m.user_id}`}{m.role === "boss" ? " #босс" : ""}</b>{m.content ? ": " : ""}{m.content} {mediaItems.map((url) => <img key={url} className="chat-inline-image" src={`${api.defaults.baseURL}${url}`} alt="chat-media" />)} {canManageSelectedRoom && <button onClick={() => removeMessage(m.id)}>Удалить</button>}</div>
              })}
            </section>
            <div className="chat-input-wrap">
            {slowmodeNotice && <div className="slowmode-notice">{slowmodeNotice}</div>}
            {chatMedia.length > 0 && <div className="chat-media-preview thumbs">{chatMedia.map((m, idx) => <div key={`${m.url}-${idx}`} className="preview-thumb-wrap"><img src={`${api.defaults.baseURL}${m.url}`} alt="preview" /><button type="button" className="preview-remove" onClick={() => removeMediaAttachment(idx, setChatMedia)}>✕</button></div>)}</div>}
            <div className="chat-input no-radius">
              <button type="button" className="clip-btn" onClick={() => chatFileInputRef.current?.click()}>📎</button>
              <input type="file" ref={chatFileInputRef} style={{ display: "none" }} multiple accept="image/*" onChange={async (e) => { if (e.target.files?.length) await addMediaAttachment(e.target.files, setChatMedia); e.target.value = '' }} />
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Сообщение" />
              <button className="post-send-btn" onClick={sendMessage}>➤</button>
            </div>
            </div>
            {chatError && <div className="auth-error">{chatError}</div>}
          </section>

          <aside className="chat-settings">
            <h3>Настройки чата</h3>
            {selectedRoom && canManageSelectedRoom ? <>
              <input ref={chatSettingsAvatarInputRef} type="file" style={{ display: 'none' }} accept="image/*" onChange={async (e) => { if (!e.target.files?.[0]) return; const uploaded = await uploadMedia(e.target.files[0]); await patchRoomSettings({ avatar_url: uploaded.url }); e.target.value = '' }} />
              <div className="setting-row"><span>Медиа</span><label className="switch"><input type="checkbox" checked={selectedRoom.allow_media} onChange={(e) => patchRoomSettings({ allow_media: e.target.checked })} /><span className="slider" /></label></div>
              <div className="setting-row cooldown-row"><span>Кулдаун</span><label className="switch"><input type="checkbox" checked={selectedRoom.cooldown_enabled} onChange={(e) => patchRoomSettings({ cooldown_enabled: e.target.checked })} /><span className="slider" /></label><input className="cooldown-input" type="number" value={selectedRoom.cooldown_seconds || 0} min={0} onChange={(e) => patchRoomSettings({ cooldown_seconds: Number(e.target.value), cooldown_enabled: false })} placeholder="сек" /></div>
              <div className="setting-row"><span>Название</span><input value={roomNameDraft} onChange={(e) => setRoomNameDraft(e.target.value)} onBlur={() => roomNameDraft.trim() && roomNameDraft !== selectedRoom.name && patchRoomSettings({ name: roomNameDraft })} /></div>
              <div className="setting-row"><span>Аватар чата</span><button type="button" onClick={() => chatSettingsAvatarInputRef.current?.click()}>Загрузить</button></div>
              <div className="setting-row"><span>Код входа</span><div className="join-code-value inline">{selectedRoom.join_code || '—'}</div></div>
              <div className="chat-members"><div className="chat-members-title">Участники</div>{roomMembers.map((member) => <div key={member.id} className="chat-member-item" style={{ color: member.nickname_color || '#cfd8ff' }}>{member.username}{member.role === 'boss' ? ' #босс' : ''}</div>)}</div>
              {!selectedRoom.is_main && <button className="danger-btn" onClick={() => deleteRoom(selectedRoom.id)}>Удалить чат</button>}
            </> : <p>Недостаточно прав для настройки.</p>}
          </aside>
        </main>
      )}
      {activeTab === 'profile' && me && (
        <main className="profile-page card">
          <section className="profile-overview card">
            <div className="avatar-wrap">
              <div className="profile-avatar" role="img" aria-label="Аватар">
                <button type="button" className="avatar-edit-btn" onClick={() => setAvatarModalOpen(true)} aria-label="Редактировать аватар">✎</button>
                <div className="avatar-ball-frame">
                  <img src={profileAvatarPixels || defaultAvatarImage} alt="Кастомный аватар" className="avatar-ball-image" />
                </div>
              </div>
            </div>
            <div className="profile-main">
              <h2>{me.username}</h2>
              <p className="role-chip">{me.role === 'boss' ? 'Лорд Рейда' : 'Искатель приключений'}</p>
              <div className="level-row">
                <span>Уровень {level}</span>
                <span>{currentXp}/{xpToNext} XP</span>
              </div>
              <div className="xp-bar"><div style={{ width: `${Math.min(100, (currentXp / xpToNext) * 100)}%` }} /></div>
              <div className="stat-grid">
                <div><span>Здоровье</span><b>{profileStats.hp}</b></div>
                <div><span>Урон</span><b>{profileStats.damage}</b></div>
                <div><span>Защита</span><b>{profileStats.defense}</b></div>
                <div><span>Точность</span><b>{profileStats.accuracy}%</b></div>
                <div><span>Скорость атаки</span><b>{profileStats.speed.toFixed(2)}x</b></div>
              </div>
            </div>
          </section>

          <section className="equipment-panel card">
            <h3>Снаряжение</h3>
            <div className="equipment-grid">
              {equipmentSlots.map((slot) => {
                const item = equippedItems[slot.key]
                return (
                  <button key={slot.key} className={`equipment-slot ${item ? 'filled' : ''}`} onClick={() => item && unequipItem(slot.key)}>
                    <span>{slot.label}</span>
                    <strong>{item ? item.name : 'Пусто'}</strong>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="abilities-panel card">
            <h3>Уникальные умения</h3>
            <div className="abilities-grid">
              {uniqueAbilities.map((ability, idx) => (
                <div key={idx} className="ability-slot">
                  <span>Слот {idx + 1}</span>
                  <strong>{ability?.name || 'Пусто'}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="inventory-panel card">
            <h3>Инвентарь</h3>
            <div className="inventory-list">
              {inventory.length === 0 && <p className="inventory-empty">Инвентарь пуст.</p>}
              {inventory.map((item) => (
                <article key={item.inventory_entry_id || `${item.id}-${item.name}`} className="inventory-item">
                  <div>
                    <h4>{item.name}</h4>
                    <p>{item.description || 'Описание появится позже'}</p>
                    <small>
                      HP +{item.hp_bonus || 0} · Урон +{item.attack_bonus || 0} · Защита +{item.defense_bonus || 0} · Точность +{item.accuracy_bonus || 0}% · Скорость +{item.attack_speed_bonus || 0}
                    </small>
                  </div>
                  <button onClick={() => equipItem(item)}>Экипировать</button>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}
      {activeTab === 'admin' && isAdmin && (
        <main className="admin-page card">
          <section className="card admin-create-item">
            <h3>Создание предмета</h3>
            <div className="admin-item-form">
              <label>Картинка предмета</label>
              <input ref={adminItemImageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { if (!e.target.files?.[0]) return; const uploaded = await uploadMedia(e.target.files[0]); setNewItem((p) => ({ ...p, image_url: uploaded.url })); e.target.value = '' }} />
              <button type="button" onClick={() => adminItemImageInputRef.current?.click()}>Загрузить с ПК</button>
              {newItem.image_url && <img src={toApiMediaUrl(newItem.image_url)} alt="item-preview" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #3a4460' }} />}
              <label>Тип предмета (слот)</label>
              <select value={newItem.slot} onChange={(e) => setNewItem((p) => ({ ...p, slot: e.target.value }))}>
                <option value="weapon">Оружие</option>
                <option value="shield">Щит</option>
                <option value="helmet">Шлем</option>
                <option value="armor">Броня</option>
                <option value="boots">Обувь</option>
                <option value="amulet">Амулет</option>
                <option value="ring">Кольцо</option>
              </select>
              <label>Название предмета</label>
              <input value={newItem.name} placeholder="Название" onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))} />
              <label>Описание предмета</label>
              <input value={newItem.description} placeholder="Описание" onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))} />
              <label>Здоровье (HP) — сколько добавляет к базовому здоровью</label>
              <input type="number" value={newItem.hp_bonus} placeholder="HP" onChange={(e) => setNewItem((p) => ({ ...p, hp_bonus: e.target.value }))} />
              <label>Урон — бонус к урону персонажа</label>
              <input type="number" value={newItem.attack_bonus} placeholder="Урон" onChange={(e) => setNewItem((p) => ({ ...p, attack_bonus: e.target.value }))} />
              <label>Защита — бонус к защите персонажа</label>
              <input type="number" value={newItem.defense_bonus} placeholder="Защита" onChange={(e) => setNewItem((p) => ({ ...p, defense_bonus: e.target.value }))} />
              <label>Точность — бонус к шансу попадания (в %)</label>
              <input type="number" value={newItem.accuracy_bonus} placeholder="Точность" onChange={(e) => setNewItem((p) => ({ ...p, accuracy_bonus: e.target.value }))} />
              <label>Скорость атаки — добавка к базовой скорости (например 0.1)</label>
              <input type="number" step="0.01" value={newItem.attack_speed_bonus} placeholder="Скорость атаки" onChange={(e) => setNewItem((p) => ({ ...p, attack_speed_bonus: e.target.value }))} />
              <label>Уникальное умение (макс. 1 на предмет, пока в разработке)</label>
              <input value={newItem.unique_skill} placeholder="Уникальное умение (макс. 1, в разработке)" onChange={(e) => setNewItem((p) => ({ ...p, unique_skill: e.target.value }))} />
              {adminItemError && <div className="auth-error">{adminItemError}</div>}
              <button onClick={createAdminItem}>Создать предмет</button>
            </div>
          </section>

          <section className="card admin-users-panel">
            <h3>Управление пользователями (старый функционал)</h3>
            <div className="admin-users-list">
              {adminUsers.map((u) => {
                const draft = adminUserDrafts[u.id] || { role: u.role, hp: u.hp, attack: u.attack, defense: u.defense, level: u.level, gold: u.gold }
                return (
                  <article key={u.id} className="admin-user-row">
                    <div className="admin-user-head">
                      <strong>{u.username}</strong>
                      <small>{u.is_banned ? 'Забанен' : 'Активен'}</small>
                    </div>
                    <div className="admin-user-controls">
                      <select value={draft.role} onChange={(e) => updateAdminUserDraft(u.id, 'role', e.target.value)}>
                        <option value="player">player</option>
                        <option value="boss">boss</option>
                        <option value="admin">admin</option>
                        <option value="master_admin">master_admin</option>
                      </select>
                      <input type="number" value={draft.hp} onChange={(e) => updateAdminUserDraft(u.id, 'hp', e.target.value)} placeholder="HP" />
                      <input type="number" value={draft.attack} onChange={(e) => updateAdminUserDraft(u.id, 'attack', e.target.value)} placeholder="Урон" />
                      <input type="number" value={draft.defense} onChange={(e) => updateAdminUserDraft(u.id, 'defense', e.target.value)} placeholder="Защита" />
                      <input type="number" value={draft.level} onChange={(e) => updateAdminUserDraft(u.id, 'level', e.target.value)} placeholder="Уровень" />
                      <input type="number" value={draft.gold} onChange={(e) => updateAdminUserDraft(u.id, 'gold', e.target.value)} placeholder="Золото" />
                    </div>
                    <div className="admin-user-actions">
                      <button onClick={() => applyAdminUserChanges(u.id)}>Сохранить</button>
                      <button onClick={() => toggleUserBan(u.id, u.is_banned)}>{u.is_banned ? 'Разбанить' : 'Забанить'}</button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="card admin-boss-panel">
            <h3>Создание босса (старый функционал)</h3>
            <div className="admin-boss-form">
              <input value={newBoss.name} onChange={(e) => setNewBoss((p) => ({ ...p, name: e.target.value }))} placeholder="Имя босса" />
              <input type="number" value={newBoss.hp} onChange={(e) => setNewBoss((p) => ({ ...p, hp: e.target.value }))} placeholder="HP" />
              <input type="number" value={newBoss.attack} onChange={(e) => setNewBoss((p) => ({ ...p, attack: e.target.value }))} placeholder="Урон" />
              <input type="number" value={newBoss.defense} onChange={(e) => setNewBoss((p) => ({ ...p, defense: e.target.value }))} placeholder="Защита" />
              <button onClick={createBossFromAdmin}>Создать босса</button>
            </div>
          </section>

          <section className="card admin-items-list">
            <h3>Предметы</h3>
            <div className="grant-controls">
              <select value={selectedGrantUserId} onChange={(e) => setSelectedGrantUserId(e.target.value)}>
                {adminUsers.filter((u) => u.role === 'player').map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
              <input type="number" min={1} value={grantQuantity} onChange={(e) => setGrantQuantity(e.target.value)} />
            </div>
            <div className="admin-item-list">
              {adminItems.map((item) => (
                <article key={item.id} className="admin-item-row">
                  <img src={item.image_url ? toApiMediaUrl(item.image_url) : 'https://placehold.co/56x56/131a2c/fff?text=I'} alt={item.name} />
                  <div>
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <small>HP +{item.hp_bonus} · Урон +{item.attack_bonus} · Защита +{item.defense_bonus} · Точность +{item.accuracy_bonus}% · Скорость +{item.attack_speed_bonus}</small>
                    <small>Уникальное умение: {item.unique_skill || 'Нет'} (в разработке)</small>
                    <small>У игроков: {item.total_instances} шт. / {item.players_owned_count} игроков</small>
                  </div>
                  <button onClick={() => grantItemToUser(item.id)}>Выдать</button>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

            {activeTab === 'boss' && <main className="card"><h2>БоссБатл</h2><p>Арена в разработке</p></main>}

      {showChannelModal && <div className="modal-backdrop"><div className="modal card"><h3>Новый канал</h3><input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="Название канала" /><input type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && setNewChannelAvatar((await uploadMedia(e.target.files[0])).url)} /><div className="channel-modal-actions"><button onClick={() => setShowChannelModal(false)}>Отмена</button><button onClick={createChannel}>Создать</button></div></div></div>}
      {showRoomModal && <div className="modal-backdrop"><div className="modal card"><h3>Новый чат</h3><input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Название чата" /><input type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && setNewRoomAvatar((await uploadMedia(e.target.files[0])).url)} /><div className="channel-modal-actions"><button onClick={() => setShowRoomModal(false)}>Отмена</button><button onClick={createRoom}>Создать</button></div></div></div>}

      {avatarModalOpen && (
        <div className="modal-backdrop">
          <div className="modal card avatar-editor-modal">
            <h3>Редактор аватара</h3>
            <div className="avatar-editor-tools">
              <button type="button" className={avatarTool === 'pencil' ? 'active' : ''} onClick={() => setAvatarTool('pencil')}>Карандаш</button>
              <button type="button" className={avatarTool === 'eraser' ? 'active' : ''} onClick={() => setAvatarTool('eraser')}>Ластик</button>
            </div>
            <div className="avatar-color-picker">
              <button
                type="button"
                className="avatar-color-swatch"
                style={{ backgroundColor: avatarColor }}
                onClick={() => avatarColorInputRef.current?.click()}
                aria-label="Выбрать цвет"
              />
              <input
                ref={avatarColorInputRef}
                type="color"
                value={avatarColor}
                className="avatar-color-native"
                onChange={(e) => { setAvatarTool('pencil'); setAvatarColor(e.target.value) }}
                aria-label="Палитра цветов"
              />
            </div>
            <canvas
              ref={avatarCanvasRef}
              className="avatar-editor-canvas"
              width={AVATAR_SIZE}
              height={AVATAR_SIZE}
              onPointerDown={(e) => { setIsAvatarDrawing(true); paintAvatarAt(e) }}
              onPointerMove={(e) => isAvatarDrawing && paintAvatarAt(e)}
              onPointerUp={() => setIsAvatarDrawing(false)}
              onPointerLeave={() => setIsAvatarDrawing(false)}
            />
            <div className="channel-modal-actions">
              <button type="button" onClick={resetAvatarDrawing}>Сбросить</button>
              <button type="button" onClick={() => setAvatarModalOpen(false)}>Отмена</button>
              <button type="button" onClick={saveAvatarDrawing}>Сохранить</button>
            </div>
          </div>
        </div>
      )}


      {imageViewer.open && <div className="image-viewer-overlay" onClick={closeImageViewer}><button type="button" className="image-viewer-close" onClick={(e) => { e.stopPropagation(); closeImageViewer() }}>✕</button><div className="image-viewer-edge left" onClick={(e) => { e.stopPropagation(); switchViewerImage(-1) }}><button type="button" className="image-viewer-arrow" aria-label="Предыдущее изображение">❮</button></div><img className="image-viewer-photo" src={`${api.defaults.baseURL}${imageViewer.images[imageViewer.index]}`} alt="full" onClick={(e) => e.stopPropagation()} /><div className="image-viewer-edge right" onClick={(e) => { e.stopPropagation(); switchViewerImage(1) }}><button type="button" className="image-viewer-arrow" aria-label="Следующее изображение">❯</button></div></div>}

      {commentModalPost && <div className="modal-backdrop"><div className="modal card"><div className="comments-header"><button className="close-top" onClick={() => setCommentModalPost(null)}>✕</button><span className="header-sep">|</span><h3>Комментарии</h3></div><div className="comments-list fixed" ref={commentsRef}>{comments.length === 0 ? <div className="empty-comments">Комментариев пока нет</div> : comments.map((c) => <div key={c.id}><b>{c.username}</b>: {c.content}</div>)}<button className="scroll-down-round" onClick={() => commentsRef.current?.scrollTo({ top: commentsRef.current.scrollHeight, behavior: 'smooth' })}>↓</button></div><div className="comment-input-wrap"><input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Комментарий" /><div className="comment-actions-right"><button className="emoji-inside-btn" onClick={() => setShowCommentEmoji(!showCommentEmoji)}>☺</button><button className="send-inline" onClick={sendComment}>›</button>{showCommentEmoji && <div className="emoji-picker-vertical" onMouseLeave={() => setShowCommentEmoji(false)}>{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={() => setCommentDraft((v) => v + emoji)}>{emoji}</button>)}</div>}</div></div></div></div>}
    </div>
  )
}
