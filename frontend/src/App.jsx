import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })

const QUICK_REACTIONS = ['👍', '🔥', '❤️', '👏', '😂']
const ALL_REACTIONS = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😍','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤗','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌']

export function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [activeTab, setActiveTab] = useState('feed')
  const [me, setMe] = useState(null)
  const [posts, setPosts] = useState([])
  const [showAllReactionsFor, setShowAllReactionsFor] = useState(null)
  const [commentModalPost, setCommentModalPost] = useState(null)
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [showCommentEmoji, setShowCommentEmoji] = useState(false)
  const commentsRef = useRef(null)

  const [newPostText, setNewPostText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [postMedia, setPostMedia] = useState(null)
  const fileInputRef = useRef(null)

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const postRefs = useRef({})

  const isBoss = me?.role === 'boss'

  const loadBase = async () => {
    const meResp = await api.get('/api/me', { headers })
    setMe(meResp.data)
    const [feedResp, lastReadResp] = await Promise.all([
      api.get('/api/news', { headers }),
      api.get('/api/news/last-read', { headers }),
    ])
    setPosts(feedResp.data)
    if (lastReadResp.data.last_read_post_id) {
      setTimeout(() => postRefs.current[lastReadResp.data.last_read_post_id]?.scrollIntoView({ block: 'center' }), 200)
    }
  }

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    loadBase()
  }, [token])

  const login = async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    const { data } = await api.post('/api/auth/login', { username: f.get('username'), password: f.get('password') })
    setToken(data.access_token)
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
    await loadBase()
  }

  const markRead = async (id) => { await api.post(`/api/news/${id}/read`, {}, { headers }) }
  const react = async (id, emoji) => { await api.post(`/api/news/${id}/reactions`, { emoji }, { headers }); await loadBase(); setShowAllReactionsFor(null) }

  const openComments = async (post) => {
    setCommentModalPost(post)
    const { data } = await api.get(`/api/news/${post.id}/comments`, { headers })
    setComments(data)
    setCommentDraft('')
    setShowCommentEmoji(false)
    setTimeout(() => commentsRef.current?.scrollTo({ top: 0 }), 0)
  }

  const scrollCommentsBottom = () => commentsRef.current?.scrollTo({ top: commentsRef.current.scrollHeight, behavior: 'smooth' })

  const sendComment = async () => {
    if (!commentModalPost || !commentDraft.trim()) return
    await api.post(`/api/news/${commentModalPost.id}/comments`, { content: commentDraft }, { headers })
    const { data } = await api.get(`/api/news/${commentModalPost.id}/comments`, { headers })
    setComments(data)
    setCommentDraft('')
  }

  if (!token) {
    return <form className="auth-card card" onSubmit={login}><h1>Login</h1><input name="username" placeholder="username" /><input name="password" placeholder="password" type="password" /><button>Login</button></form>
  }

  return (
    <div className="app-shell">
      <header className="topbar card">
        <h1>KB Raid Arena</h1>
        <nav className="tabs">
          <button onClick={() => setActiveTab('feed')} className={activeTab === 'feed' ? 'tab active' : 'tab'}>Лента</button>
        </nav>
      </header>

      {activeTab === 'feed' && (
        <main className="feed-page card">
          <section className="posts-scroll-block">
            {posts.map((p) => (
              <article key={p.id} ref={(el) => (postRefs.current[p.id] = el)} className={`tg-post card ${p.is_last_read ? 'last-read' : ''}`} onClick={() => markRead(p.id)}>
                <p>{p.content}</p>
                {p.image_url && <img className="post-image" src={`${api.defaults.baseURL}${p.image_url}`} alt="media" />}
                {p.video_url && <video className="post-video" controls src={`${api.defaults.baseURL}${p.video_url}`} />}
                <div className="post-meta">👀 {p.views} · 💬 {p.comment_count}</div>
                <div className="reactions-line">
                  {QUICK_REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}
                  <button onClick={(e) => { e.stopPropagation(); setShowAllReactionsFor(showAllReactionsFor === p.id ? null : p.id) }}>⌄</button>
                </div>
                {showAllReactionsFor === p.id && <div className="all-reactions-popup">{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={(e) => { e.stopPropagation(); react(p.id, emoji) }}>{emoji}</button>)}</div>}
                <div className="reactions-summary">{Object.entries(p.reactions || {}).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</div>
                <button onClick={(e) => { e.stopPropagation(); openComments(p) }}>Комментарии</button>
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

      {commentModalPost && (
        <div className="modal-backdrop">
          <div className="modal card">
            <h3>Комментарии</h3>
            <div className="comments-list fixed" ref={commentsRef}>
              {comments.length === 0 ? <div className="empty-comments">Комментариев пока нет</div> : comments.map((c) => <div key={c.id}><b>{c.username}</b>: {c.content}</div>)}
            </div>
            <div className="comment-actions-top"><button onClick={scrollCommentsBottom}>Вниз ⬇</button></div>
            <div className="comment-input-row">
              <button type="button" onClick={() => setShowCommentEmoji(!showCommentEmoji)}>😊</button>
              <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Комментарий" />
              <button onClick={sendComment}>Отправить</button>
            </div>
            {showCommentEmoji && <div className="emoji-picker">{ALL_REACTIONS.map((emoji) => <button key={emoji} onClick={() => setCommentDraft((v) => v + emoji)}>{emoji}</button>)}</div>}
            <button onClick={() => setCommentModalPost(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}
