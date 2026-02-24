import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })
const REACTIONS = ['👍', '🔥', '❤️', '👏', '🤯']

export function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [activeTab, setActiveTab] = useState('feed')
  const [me, setMe] = useState(null)
  const [raid, setRaid] = useState({ active: false })
  const [chat, setChat] = useState([])
  const [message, setMessage] = useState('')
  const [rooms, setRooms] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [newRoomName, setNewRoomName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [chatError, setChatError] = useState('')
  const [posts, setPosts] = useState([])
  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [passwordModalUser, setPasswordModalUser] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [adminMessage, setAdminMessage] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [commentModalPost, setCommentModalPost] = useState(null)
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [postForm, setPostForm] = useState({ title: '', content: '', audio_url: '', video_url: '' })

  const postRefs = useRef({})
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)
  const isAdmin = me?.role === 'master_admin' || me?.role === 'admin'
  const canPostAsBoss = me?.role === 'boss'

  const loadRooms = async () => {
    const { data } = await api.get('/api/rooms')
    setRooms(data)
    if (!selectedRoomId && data.length) {
      const globalRoom = data.find((room) => room.name === 'global')
      setSelectedRoomId((globalRoom || data[0]).id)
    }
  }

  const loadFeed = async () => {
    const [postsResp, lastReadResp] = await Promise.all([
      api.get('/api/news', { headers }),
      api.get('/api/news/last-read', { headers }),
    ])
    setPosts(postsResp.data)
    const targetId = lastReadResp.data.last_read_post_id
    if (targetId) {
      setTimeout(() => postRefs.current[targetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
    }
  }

  const loadUsers = async () => {
    const { data } = await api.get('/api/master-admin/users', { headers })
    setUsers(data)
  }

  const loadBaseData = async () => {
    if (!token) return
    const meResp = await api.get('/api/me', { headers })
    setMe(meResp.data)
    await Promise.all([
      api.get('/api/raid/state').then((r) => setRaid(r.data)),
      loadFeed(),
      api.get('/api/inventory', { headers }).then((r) => setInventory(r.data)),
      loadRooms(),
    ])
    if (['master_admin', 'admin'].includes(meResp.data.role)) {
      setActiveTab('admin')
      await loadUsers()
    }
  }

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    loadBaseData()
  }, [token])

  useEffect(() => {
    if (!token || !selectedRoomId) return
    api.get(`/api/chat/messages/${selectedRoomId}`).then((r) => setChat(r.data))
  }, [token, selectedRoomId])

  const login = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    setAuthError('')
    setAuthMessage('')
    try {
      const { data } = await api.post('/api/auth/login', { username: f.get('username'), password: f.get('password') })
      setToken(data.access_token)
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Не удалось войти')
    }
  }

  const register = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    const username = (f.get('username') || '').toString().trim()
    const password = (f.get('password') || '').toString()
    const confirm = (f.get('confirmPassword') || '').toString()
    setAuthError('')
    setAuthMessage('')
    if (password !== confirm) return setAuthError('Пароли не совпадают')
    try {
      await api.post('/api/auth/register', { username, password })
      setAuthMode('login')
      setAuthMessage('Регистрация успешна. Теперь войдите в аккаунт.')
      e.target.reset()
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Не удалось зарегистрироваться')
    }
  }

  const createBossPost = async (e) => {
    e.preventDefault()
    await api.post('/api/news', postForm, { headers })
    setPostForm({ title: '', content: '', audio_url: '', video_url: '' })
    await loadFeed()
  }

  const markRead = async (postId) => {
    await api.post(`/api/news/${postId}/read`, {}, { headers })
  }

  const react = async (postId, emoji) => {
    await api.post(`/api/news/${postId}/reactions`, { emoji }, { headers })
    await loadFeed()
  }

  const openComments = async (post) => {
    setCommentModalPost(post)
    const { data } = await api.get(`/api/news/${post.id}/comments`, { headers })
    setComments(data)
  }

  const sendComment = async () => {
    if (!commentModalPost || !commentDraft.trim()) return
    await api.post(`/api/news/${commentModalPost.id}/comments`, { content: commentDraft }, { headers })
    const { data } = await api.get(`/api/news/${commentModalPost.id}/comments`, { headers })
    setComments(data)
    setCommentDraft('')
    await loadFeed()
  }

  const promoteToBoss = async (userId) => { await api.patch(`/api/master-admin/users/${userId}/role`, { role: 'boss' }, { headers }); await loadUsers() }
  const savePassword = async () => { if (!passwordModalUser) return; await api.patch(`/api/master-admin/users/${passwordModalUser.id}/password`, { password: newPassword }, { headers }); setPasswordModalUser(null); setNewPassword(''); setAdminMessage('Пароль обновлен') }
  const deleteUser = async (userId) => { await api.delete(`/api/master-admin/users/${userId}`, { headers }); await loadUsers() }

  const createRoom = async (e) => { e.preventDefault(); if (!newRoomName.trim()) return; const { data } = await api.post('/api/rooms', { name: newRoomName }, { headers }); await loadRooms(); setSelectedRoomId(data.id); setNewRoomName('') }
  const joinByInvite = async (e) => { e.preventDefault(); if (!inviteCode.trim()) return; try { const { data } = await api.get(`/api/rooms/join/${inviteCode.trim()}`, { headers }); await loadRooms(); setSelectedRoomId(data.id); setInviteCode(''); setChatError('') } catch (err) { setChatError(err.response?.data?.detail || 'Неверная ссылка-приглашение') } }
  const sendMessage = async () => { if (!selectedRoomId || !message.trim()) return; const { data } = await api.post('/api/chat/messages', { room_id: selectedRoomId, content: message }, { headers }); setMessage(''); setChat((prev) => [...prev, data]) }
  const attack = async () => { await api.post('/api/raid/attack', {}, { headers }); const { data } = await api.get('/api/raid/state'); setRaid(data) }

  if (!token) {
    return <div className="auth-page"><div className="auth-card card"><h1>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h1>{authError && <div className="auth-alert auth-error">{authError}</div>}{authMessage && <div className="auth-alert auth-success">{authMessage}</div>}{authMode === 'login' ? <form className="auth-form" onSubmit={login}><input name="username" placeholder="Логин" required /><input name="password" placeholder="Пароль" type="password" required /><button>Войти</button></form> : <form className="auth-form" onSubmit={register}><input name="username" placeholder="Логин" required /><input name="password" placeholder="Пароль" type="password" required /><input name="confirmPassword" placeholder="Повторите пароль" type="password" required /><button>Зарегистрироваться</button></form>}<button className="auth-switch" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>Переключить</button></div></div>
  }

  return (
    <div className="app-shell telegram-feed">
      <header className="topbar card"><h1>KB Raid Arena</h1><nav className="tabs">{isAdmin && <button onClick={() => setActiveTab('admin')} className={activeTab === 'admin' ? 'tab active' : 'tab'}>Админка</button>}<button onClick={() => setActiveTab('feed')} className={activeTab === 'feed' ? 'tab active' : 'tab'}>Лента</button><button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'tab active' : 'tab'}>Чат</button><button onClick={() => setActiveTab('profile')} className={activeTab === 'profile' ? 'tab active' : 'tab'}>Профиль</button><button onClick={() => setActiveTab('boss')} className={activeTab === 'boss' ? 'tab active' : 'tab'}>БоссБатл</button></nav></header>

      {activeTab === 'admin' && isAdmin && <main className="card"><h2>Панель администратора</h2>{adminMessage && <div className="auth-alert auth-success">{adminMessage}</div>}<input placeholder="Поиск по нику" value={search} onChange={(e) => setSearch(e.target.value)} />{users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase())).map((u) => <div key={u.id} className="admin-line"><span>#{u.id} {u.username} ({u.role})</span><div className="admin-actions">{u.role !== 'boss' && <button onClick={() => promoteToBoss(u.id)}>Сделать боссом</button>}<button onClick={() => setPasswordModalUser(u)}>Сменить пароль</button>{u.id !== me.id && <button className="danger" onClick={() => deleteUser(u.id)}>Удалить</button>}</div></div>)}</main>}

      {activeTab === 'feed' && <main className="feed-wrap">{canPostAsBoss && <form className="card post-form" onSubmit={createBossPost}><h3>Новый пост</h3><input placeholder="Заголовок" value={postForm.title} onChange={(e) => setPostForm((p) => ({ ...p, title: e.target.value }))} required /><textarea placeholder="Текст" value={postForm.content} onChange={(e) => setPostForm((p) => ({ ...p, content: e.target.value }))} required /><input placeholder="Ссылка на аудио" value={postForm.audio_url} onChange={(e) => setPostForm((p) => ({ ...p, audio_url: e.target.value }))} /><input placeholder="Ссылка на видео" value={postForm.video_url} onChange={(e) => setPostForm((p) => ({ ...p, video_url: e.target.value }))} /><button>Опубликовать</button></form>}
        {posts.map((p) => <article key={p.id} ref={(el) => (postRefs.current[p.id] = el)} className={`tg-post card ${p.is_last_read ? 'last-read' : ''}`} onClick={() => markRead(p.id)}><h3>{p.title}</h3><small>@{p.author}</small><p>{p.content}</p>{p.audio_url && <audio controls src={p.audio_url} />} {p.video_url && <video controls src={p.video_url} />}<div className="post-meta">👀 {p.views} · 💬 {p.comment_count}</div><div className="reactions">{Object.entries(p.reactions || {}).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</div><div className="actions">{REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}<button onClick={(e) => { e.stopPropagation(); openComments(p) }}>Комментарии</button></div></article>)}
      </main>}

      {activeTab === 'chat' && <main className="chat-layout"><section className="card"><h2>Каналы</h2>{rooms.map((room) => <button key={room.id} className={`room-btn ${selectedRoomId === room.id ? 'room-active' : ''} ${room.name === 'global' ? 'room-global' : ''}`} onClick={() => setSelectedRoomId(room.id)}>{room.name === 'global' ? '📌 Главный канал' : `# ${room.name}`}</button>)}<form onSubmit={createRoom} className="stack"><input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Название нового канала" /><button type="submit">Создать канал</button></form><form onSubmit={joinByInvite} className="stack"><input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Код приглашения" /><button type="submit">Присоединиться</button></form></section><section className="card"><h2>Чат: {selectedRoom?.name || '—'}</h2>{chatError && <div className="auth-alert auth-error">{chatError}</div>}<div className="chat">{chat.map((m, idx) => <div key={m.id || idx}>{m.content || m.message}</div>)}</div><input value={message} onChange={(e) => setMessage(e.target.value)} /><button onClick={sendMessage}>Send</button></section></main>}

      {activeTab === 'profile' && <main className="card"><h2>Профиль</h2><p>{me?.username} ({me?.role})</p><div className="grid">{inventory.map((i) => <div key={i.id} className="item">{i.name}<small>{i.rarity}</small></div>)}</div></main>}
      {activeTab === 'boss' && <main className="card boss-arena"><h2>БоссБатл</h2><div className="hp-wrap"><div className="hp" style={{ width: `${raid.boss_hp ? (raid.boss_hp / 2000) * 100 : 0}%` }} /></div><button onClick={attack}>Attack</button></main>}

      {passwordModalUser && <div className="modal-backdrop"><div className="modal card"><h3>Сменить пароль: {passwordModalUser.username}</h3><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль" /><div className="actions"><button onClick={savePassword}>Сохранить</button><button onClick={() => setPasswordModalUser(null)}>Отмена</button></div></div></div>}
      {commentModalPost && <div className="modal-backdrop"><div className="modal card"><h3>Комментарии — {commentModalPost.title}</h3><div className="comments-list">{comments.map((c) => <div key={c.id}><b>{c.username}</b>: {c.content}</div>)}</div><input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Комментарий" /><div className="actions"><button onClick={sendComment}>Отправить</button><button onClick={() => setCommentModalPost(null)}>Закрыть</button></div></div></div>}
    </div>
  )
}
