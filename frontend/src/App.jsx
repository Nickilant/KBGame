import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })
const ALL_REACTIONS = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😍','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤗','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌']

export function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')

  const [activeTab, setActiveTab] = useState('feed')
  const [me, setMe] = useState(null)
  const [posts, setPosts] = useState([])
  const [newPostText, setNewPostText] = useState('')
  const [postMedia, setPostMedia] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [hoveredPostId, setHoveredPostId] = useState(null)
  const fileInputRef = useRef(null)

  const [rooms, setRooms] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [chat, setChat] = useState([])
  const [message, setMessage] = useState('')

  const [commentModalPost, setCommentModalPost] = useState(null)
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [showCommentEmoji, setShowCommentEmoji] = useState(false)
  const commentsRef = useRef(null)

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const isBoss = me?.role === 'boss'

  const loadFeed = async () => {
    const [feedResp, lastReadResp] = await Promise.all([
      api.get('/api/news', { headers }),
      api.get('/api/news/last-read', { headers }),
    ])
    const asc = [...feedResp.data].reverse()
    setPosts(asc)
    if (lastReadResp.data.last_read_post_id) {
      setTimeout(() => document.getElementById(`post-${lastReadResp.data.last_read_post_id}`)?.scrollIntoView({ block: 'center' }), 150)
    }
  }

  const loadBase = async () => {
    const meResp = await api.get('/api/me', { headers })
    setMe(meResp.data)
    await loadFeed()
    const { data: roomData } = await api.get('/api/rooms')
    setRooms(roomData)
    if (roomData.length) setSelectedRoomId((roomData.find((r) => r.name === 'global') || roomData[0]).id)
  }

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    loadBase()
  }, [token])

  useEffect(() => {
    if (!token || !selectedRoomId) return
    api.get(`/api/chat/messages/${selectedRoomId}`).then((r) => setChat(r.data))
  }, [token, selectedRoomId])

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
      setPostMedia(data)
    } finally {
      setUploading(false)
    }
  }

  const createPost = async (e) => {
    e.preventDefault()
    if (!newPostText.trim() && !postMedia) return
    await api.post('/api/news', {
      title: newPostText.slice(0, 60) || 'Новый пост',
      content: newPostText || ' ',
      image_url: postMedia?.type === 'image' ? postMedia.url : '',
      video_url: postMedia?.type === 'video' ? postMedia.url : '',
      audio_url: ''
    }, { headers })
    setNewPostText('')
    setPostMedia(null)
    await loadFeed()
  }

  const react = async (id, emoji) => { await api.post(`/api/news/${id}/reactions`, { emoji }, { headers }); await loadFeed() }
  const markRead = async (id) => { await api.post(`/api/news/${id}/read`, {}, { headers }) }

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
    setCommentDraft('')
  }

  const sendMessage = async () => {
    if (!selectedRoomId || !message.trim()) return
    const { data } = await api.post('/api/chat/messages', { room_id: selectedRoomId, content: message }, { headers })
    setChat((prev) => [...prev, data])
    setMessage('')
  }

  if (!token) {
    return (
      <div className="auth-page">
        <form className="auth-card card" onSubmit={authMode === 'login' ? login : register}>
          <h1>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h1>
          {authError && <div className="auth-error">{authError}</div>}
          <input name="username" placeholder="Логин" required />
          <input name="password" placeholder="Пароль" type="password" required />
          {authMode === 'register' && <input name="confirmPassword" placeholder="Повторите пароль" type="password" required />}
          <button>{authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
          <button type="button" className="link-btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Вход'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar card">
        <h1>KB Raid Arena</h1>
        <nav className="tabs">
          <button onClick={() => setActiveTab('feed')} className={activeTab === 'feed' ? 'tab active' : 'tab'}>Лента</button>
          <button onClick={() => setActiveTab('chat')} className={activeTab === 'chat' ? 'tab active' : 'tab'}>Чат</button>
          <button onClick={() => setActiveTab('profile')} className={activeTab === 'profile' ? 'tab active' : 'tab'}>Профиль</button>
          <button onClick={() => setActiveTab('boss')} className={activeTab === 'boss' ? 'tab active' : 'tab'}>БоссБатл</button>
        </nav>
      </header>

      {activeTab === 'feed' && (
        <main className="feed-page card">
          <section className="posts-scroll-block">
            {posts.map((p) => (
              <article
                id={`post-${p.id}`}
                key={p.id}
                className="tg-post card"
                onMouseEnter={() => setHoveredPostId(p.id)}
                onMouseLeave={() => setHoveredPostId(null)}
                onClick={() => markRead(p.id)}
              >
                {p.image_url && <img className="post-image" src={`${api.defaults.baseURL}${p.image_url}`} alt="media" />}
                {p.video_url && <video className="post-video" controls src={`${api.defaults.baseURL}${p.video_url}`} />}
                <p className="post-text">{p.content}</p>
                <div className="post-meta">👀 {p.views} · 💬 {p.comment_count}</div>

                {hoveredPostId === p.id && (
                  <div className="hover-reactions-strip">
                    {ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}
                  </div>
                )}

                <div className="reactions-summary">{Object.entries(p.reactions || {}).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</div>
                <button className="comments-full" onClick={(e) => { e.stopPropagation(); openComments(p) }}>Комментарии</button>
              </article>
            ))}
          </section>

          {isBoss && (
            <form className="post-input-row" onSubmit={createPost}>
              <button type="button" className="clip-btn" onClick={() => fileInputRef.current?.click()}>📎</button>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*" onChange={(e) => e.target.files?.[0] && uploadMedia(e.target.files[0])} />
              <input value={newPostText} onChange={(e) => setNewPostText(e.target.value)} placeholder="Текст поста" />
              <button type="submit" disabled={uploading}>{uploading ? 'Загрузка…' : 'Отправить'}</button>
            </form>
          )}
        </main>
      )}

      {activeTab === 'chat' && (
        <main className="chat-page card">
          <h2>Чат</h2>
          <div className="chat-rooms">{rooms.map((r) => <button key={r.id} className={selectedRoomId === r.id ? 'tab active' : 'tab'} onClick={() => setSelectedRoomId(r.id)}>{r.name}</button>)}</div>
          <div className="chat-box">{chat.map((m, i) => <div key={m.id || i}>{m.content}</div>)}</div>
          <div className="chat-input"><input value={message} onChange={(e) => setMessage(e.target.value)} /><button onClick={sendMessage}>Отправить</button></div>
        </main>
      )}

      {activeTab === 'profile' && <main className="card"><h2>Профиль</h2><p>{me.username} ({me.role})</p></main>}
      {activeTab === 'boss' && <main className="card"><h2>БоссБатл</h2><p>Арена в разработке</p></main>}

      {commentModalPost && (
        <div className="modal-backdrop">
          <div className="modal card">
            <button className="close-top" onClick={() => setCommentModalPost(null)}>Закрыть</button>
            <h3>Комментарии</h3>
            <div className="comments-list fixed" ref={commentsRef}>
              {comments.length === 0 ? <div className="empty-comments">Комментариев пока нет</div> : comments.map((c) => <div key={c.id}><b>{c.username}</b>: {c.content}</div>)}
              <button className="scroll-down-round" onClick={() => commentsRef.current?.scrollTo({ top: commentsRef.current.scrollHeight, behavior: 'smooth' })}>↓</button>
            </div>
            <div className="comment-input-wrap">
              <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Комментарий" />
              <button className="emoji-inside-btn" onClick={() => setShowCommentEmoji(!showCommentEmoji)}>😊</button>
            </div>
            {showCommentEmoji && <div className="emoji-picker">{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={() => setCommentDraft((v) => v + emoji)}>{emoji}</button>)}</div>}
            <button onClick={sendComment}>Отправить</button>
          </div>
        </div>
      )}
    </div>
  )
}
