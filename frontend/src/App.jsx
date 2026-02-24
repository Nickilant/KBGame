import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })

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
  const [passwordDrafts, setPasswordDrafts] = useState({})
  const [adminMessage, setAdminMessage] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)

  const loadRooms = async () => {
    const { data } = await api.get('/api/rooms')
    setRooms(data)
    if (!selectedRoomId && data.length) {
      const globalRoom = data.find((room) => room.name === 'global')
      setSelectedRoomId((globalRoom || data[0]).id)
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
      api.get('/api/news').then((r) => setPosts(r.data)),
      api.get('/api/inventory', { headers }).then((r) => setInventory(r.data)),
      loadRooms(),
    ])

    if (meResp.data.role === 'master_admin') {
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

  useEffect(() => {
    if (!token) return
    const ws = new WebSocket((import.meta.env.VITE_WS_URL || 'ws://localhost:8000') + '/ws/global')
    ws.onmessage = (e) => {
      const incoming = JSON.parse(e.data)
      if (!incoming.room_id || incoming.room_id === selectedRoomId) {
        setChat((prev) => [...prev, incoming])
      }
    }
    return () => ws.close()
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

    if (password !== confirm) {
      setAuthError('Пароли не совпадают')
      return
    }

    try {
      await api.post('/api/auth/register', { username, password })
      setAuthMode('login')
      setAuthMessage('Регистрация успешна. Теперь войдите в аккаунт.')
      e.target.reset()
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Не удалось зарегистрироваться')
    }
  }

  const attack = async () => {
    await api.post('/api/raid/attack', {}, { headers })
    const { data } = await api.get('/api/raid/state')
    setRaid(data)
  }

  const sendMessage = async () => {
    if (!selectedRoomId || !message.trim()) return
    setChatError('')
    try {
      const { data } = await api.post('/api/chat/messages', { room_id: selectedRoomId, content: message }, { headers })
      setMessage('')
      setChat((prev) => [...prev, data])
    } catch (err) {
      setChatError(err.response?.data?.detail || 'Не удалось отправить сообщение')
    }
  }

  const createRoom = async (e) => {
    e.preventDefault()
    if (!newRoomName.trim()) return
    const { data } = await api.post('/api/rooms', { name: newRoomName }, { headers })
    await loadRooms()
    setSelectedRoomId(data.id)
    setNewRoomName('')
  }

  const joinByInvite = async (e) => {
    e.preventDefault()
    if (!inviteCode.trim()) return
    try {
      const { data } = await api.get(`/api/rooms/join/${inviteCode.trim()}`, { headers })
      await loadRooms()
      setSelectedRoomId(data.id)
      setInviteCode('')
      setChatError('')
    } catch (err) {
      setChatError(err.response?.data?.detail || 'Неверная ссылка-приглашение')
    }
  }

  const promoteToBoss = async (userId) => {
    await api.patch(`/api/master-admin/users/${userId}/role`, { role: 'boss' }, { headers })
    await loadUsers()
    setAdminMessage('Роль обновлена: пользователь назначен боссом.')
  }

  const resetPassword = async (userId) => {
    const password = passwordDrafts[userId]?.trim()
    if (!password || password.length < 6) {
      setAdminMessage('Новый пароль должен быть не короче 6 символов.')
      return
    }
    await api.patch(`/api/master-admin/users/${userId}/password`, { password }, { headers })
    setPasswordDrafts((prev) => ({ ...prev, [userId]: '' }))
    setAdminMessage('Пароль пользователя обновлён.')
  }

  const deleteUser = async (userId) => {
    await api.delete(`/api/master-admin/users/${userId}`, { headers })
    await loadUsers()
    setAdminMessage('Пользователь удалён.')
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card card">
          <p className="auth-eyebrow">KB Raid Arena</p>
          <h1>{authMode === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}</h1>
          <p className="auth-subtitle">
            {authMode === 'login'
              ? 'Войдите, чтобы продолжить бой с боссами и общение в чате.'
              : 'Зарегистрируйтесь и начните приключение в мире рейдов.'}
          </p>

          {authError && <div className="auth-alert auth-error">{authError}</div>}
          {authMessage && <div className="auth-alert auth-success">{authMessage}</div>}

          {authMode === 'login' ? (
            <form className="auth-form" onSubmit={login}>
              <input name="username" placeholder="Логин" required minLength={3} />
              <input name="password" placeholder="Пароль" type="password" required minLength={6} />
              <button type="submit">Войти</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={register}>
              <input name="username" placeholder="Логин" required minLength={3} />
              <input name="password" placeholder="Пароль" type="password" required minLength={6} />
              <input name="confirmPassword" placeholder="Повторите пароль" type="password" required minLength={6} />
              <button type="submit">Зарегистрироваться</button>
            </form>
          )}

          <button type="button" className="auth-switch" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войти'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar card">
        <h1>KB Raid Arena</h1>
        <nav className="tabs">
          {me?.role === 'master_admin' && <button onClick={() => setActiveTab('admin')} className={activeTab === 'admin' ? 'tab active' : 'tab'}>Админка</button>}
          <button onClick={() => setActiveTab('feed')} className={activeTab === 'feed' ? 'tab active' : 'tab'}>Лента</button>
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'tab active' : 'tab'}>Чат</button>
          <button onClick={() => setActiveTab('profile')} className={activeTab === 'profile' ? 'tab active' : 'tab'}>Профиль</button>
          <button onClick={() => setActiveTab('boss')} className={activeTab === 'boss' ? 'tab active' : 'tab'}>БоссБатл</button>
        </nav>
      </header>

      {activeTab === 'admin' && me?.role === 'master_admin' && (
        <main className="card">
          <h2>Панель администратора</h2>
          <p>Управление пользователями системы.</p>
          {adminMessage && <div className="auth-alert auth-success">{adminMessage}</div>}
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>ID</span><span>Логин</span><span>Роль</span><span>Действия</span>
            </div>
            {users.map((u) => (
              <div className="admin-row" key={u.id}>
                <span>{u.id}</span>
                <span>{u.username}</span>
                <span>{u.role}</span>
                <div className="admin-actions">
                  {u.role !== 'boss' && <button onClick={() => promoteToBoss(u.id)}>Назначить боссом</button>}
                  <input
                    placeholder="Новый пароль"
                    value={passwordDrafts[u.id] || ''}
                    onChange={(e) => setPasswordDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  />
                  <button onClick={() => resetPassword(u.id)}>Сменить пароль</button>
                  {u.id !== me.id && <button className="danger" onClick={() => deleteUser(u.id)}>Удалить</button>}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {activeTab === 'feed' && (
        <main className="card">
          <h2>Лента Босса</h2>
          {posts.length === 0 && <p>Пока нет постов от пользователей с ролью boss.</p>}
          {posts.map((p) => <article key={p.id}><h3>{p.title}</h3><p>{p.content}</p><small>❤ {p.likes}</small></article>)}
        </main>
      )}

      {activeTab === 'chat' && (
        <main className="chat-layout">
          <section className="card">
            <h2>Каналы</h2>
            {rooms.map((room) => (
              <button
                key={room.id}
                className={`room-btn ${selectedRoomId === room.id ? 'room-active' : ''} ${room.name === 'global' ? 'room-global' : ''}`}
                onClick={() => setSelectedRoomId(room.id)}
              >
                {room.name === 'global' ? '📌 Главный канал' : `# ${room.name}`}
              </button>
            ))}
            <form onSubmit={createRoom} className="stack">
              <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Название нового канала" />
              <button type="submit">Создать канал</button>
            </form>
            <form onSubmit={joinByInvite} className="stack">
              <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Код приглашения" />
              <button type="submit">Присоединиться по ссылке</button>
            </form>
            {selectedRoom?.invite_code && <p>Ссылка: {window.location.origin}/chat/join/{selectedRoom.invite_code}</p>}
          </section>

          <section className="card">
            <h2>Чат: {selectedRoom?.name || '—'}</h2>
            {chatError && <div className="auth-alert auth-error">{chatError}</div>}
            <div className="chat">{chat.map((m, idx) => <div key={m.id || idx}>{m.content || m.message}</div>)}</div>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="say something" />
            <button onClick={sendMessage}>Send</button>
          </section>
        </main>
      )}

      {activeTab === 'profile' && (
        <main className="card">
          <h2>Профиль</h2>
          <p>Игрок: <b>{me?.username}</b></p>
          <p>Роль: <b>{me?.role}</b></p>
          <p>HP: {me?.hp} | ATK: {me?.attack} | DEF: {me?.defense} | LVL: {me?.level} | Gold: {me?.gold}</p>
          <h3>Инвентарь</h3>
          <div className="grid">{inventory.map((i) => <div key={i.id} className="item">{i.name}<small>{i.rarity}</small></div>)}</div>
        </main>
      )}

      {activeTab === 'boss' && (
        <main className="card boss-arena">
          <h2>БоссБатл Арена</h2>
          <div className="arena-visual">
            <div className="boss-avatar">👹<span>{raid.boss_name || 'Босс спит'}</span></div>
            <div className="players-wrap">
              {Object.keys(raid.leaderboard || {}).length === 0 && <div>Пока нет участников.</div>}
              {Object.entries(raid.leaderboard || {}).map(([playerId, dmg]) => (
                <div key={playerId} className="player-chip">⚔️ Игрок #{playerId} — {dmg} урона</div>
              ))}
            </div>
          </div>
          <div className="hp-wrap"><div className="hp" style={{ width: `${raid.boss_hp ? (raid.boss_hp / 2000) * 100 : 0}%` }} /></div>
          <p>HP: {raid.boss_hp ?? '-'}</p>
          <button onClick={attack}>Attack (3s CD)</button>
          {(me?.role === 'boss' || me?.role === 'master_admin') && <button onClick={() => api.post('/api/raid/start', {}, { headers })}>Start Raid</button>}
        </main>
      )}
    </div>
  )
}
