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
  const [channels, setChannels] = useState([])
  const [selectedChannelId, setSelectedChannelId] = useState(null)
  const [newPostText, setNewPostText] = useState('')
  const [postMedia, setPostMedia] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [hoveredPostId, setHoveredPostId] = useState(null)
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelAvatar, setNewChannelAvatar] = useState('')
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

  const loadChannels = async () => {
    const { data } = await api.get('/api/channels', { headers })
    setChannels(data)
    if (data.length && !data.some((c) => c.id === selectedChannelId)) {
      setSelectedChannelId(data[0].id)
    }
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

  const loadBase = async () => {
    const meResp = await api.get('/api/me', { headers })
    setMe(meResp.data)
    await loadChannels()
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
    if (!token || selectedChannelId == null) return
    loadFeed(true)
  }, [token, selectedChannelId])

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
      return data
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
      audio_url: '',
      channel_id: selectedChannelId,
    }, { headers })
    setNewPostText('')
    setPostMedia(null)
    await Promise.all([loadFeed(false), loadChannels()])
  }

  const createChannel = async () => {
    if (!newChannelName.trim()) return
    await api.post('/api/channels', { name: newChannelName, avatar_url: newChannelAvatar }, { headers })
    setNewChannelName('')
    setNewChannelAvatar('')
    setShowChannelModal(false)
    await loadChannels()
  }

  const react = async (id, emoji) => {
    await api.post(`/api/news/${id}/reactions`, { emoji }, { headers })
    await Promise.all([loadFeed(false), loadChannels()])
  }

  const deletePost = async (id) => {
    await api.delete(`/api/news/${id}`, { headers })
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
    setCommentDraft('')
  }

  const sendMessage = async () => {
    if (!selectedRoomId || !message.trim()) return
    const { data } = await api.post('/api/chat/messages', { room_id: selectedRoomId, content: message }, { headers })
    setChat((prev) => [...prev, data])
    setMessage('')
  }

  if (!token) {
    return <div className="auth-page"><form className="auth-card card" onSubmit={authMode === 'login' ? login : register}><h1>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h1>{authError && <div className="auth-error">{authError}</div>}<input name="username" placeholder="Логин" required /><input name="password" type="password" placeholder="Пароль" required />{authMode === 'register' && <input name="confirmPassword" type="password" placeholder="Повторите пароль" required />}<button type="submit">{authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button><button type="button" className="link-btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Вход'}</button></form></div>
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
          <aside className="channels-sidebar">
            <div className="channels-header">Каналы {isBoss && <><span>|</span><button onClick={() => setShowChannelModal(true)} className="add-channel-btn">+</button></>}</div>
            <div className="channels-list">{channels.length === 0 ? <div className="channels-empty">Каналов пока нет</div> : channels.map((c) => <button key={c.id} className={`channel-item ${selectedChannelId === c.id ? 'active' : ''}`} onClick={() => setSelectedChannelId(c.id)}><img src={c.avatar_url ? `${api.defaults.baseURL}${c.avatar_url}` : 'https://placehold.co/40x40/1f2433/ffffff?text=%23'} alt={c.name} /><div className="channel-main"><span>{c.name}</span>{c.unread_count > 0 && <small>{c.unread_count}</small>}</div></button>)}</div>
          </aside>

          <section className="posts-column">
            <section className="posts-scroll-block">
              {posts.map((p) => (
                <div key={p.id} className="post-shell" onMouseEnter={() => setHoveredPostId(p.id)} onMouseLeave={() => setHoveredPostId(null)}>
                  <article id={`post-${p.id}`} className="tg-post card" onClick={() => markRead(p.id)}>
                    {p.image_url && <img className="post-image" src={`${api.defaults.baseURL}${p.image_url}`} alt="media" />}
                    {p.video_url && <video className="post-video" controls src={`${api.defaults.baseURL}${p.video_url}`} />}
                    <div className="post-body">
                      <p className="post-text">{p.content}</p>
                      <div className="post-meta"><span className="views-right">Просмотры: {p.views}</span></div>
                      <button className="comments-full" onClick={(e) => { e.stopPropagation(); openComments(p) }}><span>{p.comment_count > 0 ? `Комментариев ${p.comment_count}` : 'Прокомментировать'}</span><span className="row-arrow">›</span></button>
                      {isBoss && <button className="delete-post-btn" onClick={(e) => { e.stopPropagation(); deletePost(p.id) }}>Удалить пост</button>}
                    </div>
                  </article>

                  {hoveredPostId === p.id && <div className="hover-reactions-vertical">{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}</div>}
                  <div className="reactions-summary under-post">{Object.entries(p.reactions || {}).map(([emoji, count]) => <button className={`reaction-capsule ${p.my_reaction === emoji ? 'mine' : ''}`} key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji} {count}</button>)}</div>
                </div>
              ))}
            </section>

            {isBoss && <form className="post-input-wrap" onSubmit={createPost}>{postMedia && <div className="composer-preview">{postMedia.type === 'image' ? <img src={`${api.defaults.baseURL}${postMedia.url}`} alt="preview" /> : <video controls src={`${api.defaults.baseURL}${postMedia.url}`} />}</div>}<div className="post-input-row"><button type="button" className="clip-btn" onClick={() => fileInputRef.current?.click()}>📎</button><span className="input-v-sep" aria-hidden="true">|</span><input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*" onChange={async (e) => e.target.files?.[0] && setPostMedia(await uploadMedia(e.target.files[0]))} /><input value={newPostText} onChange={(e) => setNewPostText(e.target.value)} placeholder="Текст поста" /><button type="submit" className="post-send-btn" disabled={uploading}>{uploading ? '…' : '›'}</button></div></form>}
          </section>
        </main>
      )}

      {activeTab === 'chat' && <main className="chat-page card"><h2>Чат</h2><div className="chat-rooms">{rooms.map((r) => <button key={r.id} className={selectedRoomId === r.id ? 'tab active' : 'tab'} onClick={() => setSelectedRoomId(r.id)}>{r.name}</button>)}</div><div className="chat-box">{chat.map((m, i) => <div key={m.id || i}>{m.content}</div>)}</div><div className="chat-input"><input value={message} onChange={(e) => setMessage(e.target.value)} /><button onClick={sendMessage}>Отправить</button></div></main>}
      {activeTab === 'profile' && <main className="card"><h2>Профиль</h2><p>{me.username} ({me.role})</p></main>}
      {activeTab === 'boss' && <main className="card"><h2>БоссБатл</h2><p>Арена в разработке</p></main>}

      {showChannelModal && <div className="modal-backdrop"><div className="modal card"><h3>Новый канал</h3><input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="Название канала" /><input type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && setNewChannelAvatar((await uploadMedia(e.target.files[0])).url)} /><div className="channel-modal-actions"><button onClick={() => setShowChannelModal(false)}>Отмена</button><button onClick={createChannel}>Создать</button></div></div></div>}

      {commentModalPost && <div className="modal-backdrop"><div className="modal card"><div className="comments-header"><button className="close-top" onClick={() => setCommentModalPost(null)}>✕</button><span className="header-sep">|</span><h3>Комментарии</h3></div><div className="comments-list fixed" ref={commentsRef}>{comments.length === 0 ? <div className="empty-comments">Комментариев пока нет</div> : comments.map((c) => <div key={c.id}><b>{c.username}</b>: {c.content}</div>)}<button className="scroll-down-round" onClick={() => commentsRef.current?.scrollTo({ top: commentsRef.current.scrollHeight, behavior: 'smooth' })}>↓</button></div><div className="comment-input-wrap"><input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Комментарий" /><div className="comment-actions-right"><button className="emoji-inside-btn" onClick={() => setShowCommentEmoji(!showCommentEmoji)}>☺</button><button className="send-inline" onClick={sendComment}>›</button>{showCommentEmoji && <div className="emoji-picker-vertical" onMouseLeave={() => setShowCommentEmoji(false)}>{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={() => setCommentDraft((v) => v + emoji)}>{emoji}</button>)}</div>}</div></div></div></div>}
    </div>
  )
}
