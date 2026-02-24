import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })

export function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [me, setMe] = useState(null)
  const [raid, setRaid] = useState({ active: false })
  const [chat, setChat] = useState([])
  const [message, setMessage] = useState('')
  const [rooms, setRooms] = useState([])
  const [posts, setPosts] = useState([])
  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    api.get('/api/me', { headers }).then((r) => setMe(r.data))
    api.get('/api/raid/state').then((r) => setRaid(r.data))
    api.get('/api/news').then((r) => setPosts(r.data))
    api.get('/api/rooms').then((r) => setRooms(r.data))
    api.get('/api/inventory', { headers }).then((r) => setInventory(r.data))
    api.get('/api/chat/messages/1').then((r) => setChat(r.data))
    if (me?.role === 'master_admin') {
      api.get('/api/master-admin/users', { headers }).then((r) => setUsers(r.data))
    }
  }, [token])

  useEffect(() => {
    const ws = new WebSocket((import.meta.env.VITE_WS_URL || 'ws://localhost:8000') + '/ws/global')
    ws.onmessage = (e) => setChat((prev) => [...prev, JSON.parse(e.data)])
    return () => ws.close()
  }, [])

  const login = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    const { data } = await api.post('/api/auth/login', { username: f.get('username'), password: f.get('password') })
    setToken(data.access_token)
  }

  const attack = async () => {
    await api.post('/api/raid/attack', {}, { headers })
    const { data } = await api.get('/api/raid/state')
    setRaid(data)
  }

  const sendMessage = async () => {
    const { data } = await api.post('/api/chat/messages', { room_id: 1, content: message }, { headers })
    setMessage('')
    setChat((prev) => [...prev, data])
  }

  if (!token) {
    return <form className="card" onSubmit={login}><h1>KB Raid Login</h1><input name="username" placeholder="username"/><input name="password" placeholder="password" type="password"/><button>Login</button></form>
  }

  return (
    <div className="layout">
      <main>
        <h1>Boss Raid Arena</h1>
        <div className="card">
          <h2>{raid.boss_name || 'No active raid'}</h2>
          <div className="hp-wrap"><div className="hp" style={{ width: `${raid.boss_hp ? (raid.boss_hp / 2000) * 100 : 0}%` }} /></div>
          <p>HP: {raid.boss_hp ?? '-'}</p>
          <button onClick={attack}>Attack (3s CD)</button>
          {(me?.role === 'boss' || me?.role === 'master_admin') && <button onClick={() => api.post('/api/raid/start', {}, { headers })}>Start Raid</button>}
        </div>
        <div className="card"><h2>Top Damage</h2>{raid.leaderboard && Object.entries(raid.leaderboard).map(([k,v])=><div key={k}>#{k}: {v}</div>)}</div>
        <div className="card"><h2>Inventory</h2><div className="grid">{inventory.map((i)=><div key={i.id} className="item">{i.name}<small>{i.rarity}</small></div>)}</div></div>
        <div className="card"><h2>News</h2>{posts.map((p)=><article key={p.id}><h3>{p.title}</h3><p>{p.content}</p><small>❤ {p.likes}</small></article>)}</div>
        {me?.role === 'master_admin' && <div className="card"><h2>/master-admin panel</h2>{users.map((u)=><div key={u.id}>{u.username} - {u.role} - banned:{String(u.is_banned)}</div>)}</div>}
      </main>
      <aside className="card">
        <h2>Chat</h2>
        <div className="chat">{chat.map((m,idx)=><div key={m.id||idx}>{m.content || m.message}</div>)}</div>
        <input value={message} onChange={(e)=>setMessage(e.target.value)} placeholder="say something" />
        <button onClick={sendMessage}>Send</button>
        <p>Rooms: {rooms.map((r)=>r.name).join(', ')}</p>
      </aside>
    </div>
  )
}
