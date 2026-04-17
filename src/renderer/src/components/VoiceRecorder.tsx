import { useState, useRef, useCallback, useEffect } from 'react'
import { AppSettings } from '../../../shared/types'

interface Props {
  onTranscript: (text: string) => void
  isStreaming:   boolean
  settings:     AppSettings
  lastAIMessage?: string
}

export default function VoiceRecorder({ onTranscript, isStreaming, settings, lastAIMessage }: Props) {
  const [listening, setListening]       = useState(false)
  const [transcript, setTranscript]     = useState('')
  const [ttsEnabled, setTtsEnabled]     = useState(false)
  const [ttsPlaying, setTtsPlaying]     = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const synthRef  = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null)
  const prevAIRef = useRef<string>('')

  // Use browser SpeechRecognition if available (Chromium)
  const hasSpeechAPI = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const startListening = useCallback(async () => {
    setListening(true)
    setTranscript('')

    if (hasSpeechAPI) {
      // Browser speech recognition (free, works in Electron/Chromium)
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = ''
        let final   = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i]
          if (r.isFinal) final += r[0].transcript
          else interim += r[0].transcript
        }
        setTranscript(prev => (prev + final).trim())
        if (interim) setTranscript(prev => prev ? `${prev} ${interim}` : interim)
      }

      recognition.onerror = () => setListening(false)
      recognition.onend = () => setListening(false)

      recognition.start()
      recognitionRef.current = recognition
    } else {
      // Fallback: MediaRecorder → Whisper API
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        chunksRef.current = []
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          const reader = new FileReader()
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1]
            if (base64 && window.api) {
              const result = await window.api.voiceTranscribe(base64, settings)
              if (result.ok && result.text) {
                setTranscript(result.text)
              }
            }
          }
          reader.readAsDataURL(blob)
        }
        mediaRecorder.start()
        mediaRecorderRef.current = mediaRecorder
      } catch (e) {
        setListening(false)
      }
    }
  }, [hasSpeechAPI, settings])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setListening(false)
  }, [])

  // Send transcript when user stops talking
  const handleSend = useCallback(() => {
    if (transcript.trim()) {
      onTranscript(transcript.trim())
      setTranscript('')
    }
  }, [transcript, onTranscript])

  // Auto-read AI response aloud via browser TTS
  useEffect(() => {
    if (!ttsEnabled || !lastAIMessage || !synthRef.current) return
    if (lastAIMessage === prevAIRef.current) return
    prevAIRef.current = lastAIMessage

    // Cancel any ongoing speech
    synthRef.current.cancel()

    // Strip markdown formatting for cleaner speech
    const clean = lastAIMessage
      .replace(/```[\s\S]*?```/g, ' (code block) ')
      .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
      .replace(/[#*_~>\-|]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 2000)

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 1.1
    utterance.onstart = () => setTtsPlaying(true)
    utterance.onend   = () => setTtsPlaying(false)
    utterance.onerror = () => setTtsPlaying(false)
    synthRef.current.speak(utterance)
  }, [lastAIMessage, ttsEnabled])

  // Cleanup
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      mediaRecorderRef.current?.stop()
      synthRef.current?.cancel()
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {/* Mic button */}
      <button
        onClick={listening ? stopListening : startListening}
        disabled={isStreaming}
        className={`
          w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg
          ${listening
            ? 'bg-red-500 hover:bg-red-600 scale-110 shadow-red-500/30'
            : 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20'
          }
          ${isStreaming ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}
        `}
        aria-label={listening ? 'Stop recording' : 'Start recording'}
      >
        {listening ? (
          <div className="flex items-center gap-0.5">
            <span className="w-1 h-4 bg-white rounded-full animate-pulse" />
            <span className="w-1 h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.1s' }} />
            <span className="w-1 h-3 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <span className="w-1 h-5 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
          </div>
        ) : (
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      {/* Status text */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {listening ? 'Listening... click to stop' : isStreaming ? 'AI is responding...' : 'Click to speak'}
      </p>

      {/* Provider compatibility badge */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        <span className="text-[10px] text-green-700 dark:text-green-400 font-medium">
          {hasSpeechAPI
            ? 'Works with any AI provider — no extra API key needed'
            : 'Requires OpenAI key for voice transcription (Whisper)'}
        </span>
      </div>

      {/* Transcript preview */}
      {transcript && (
        <div className="w-full max-w-md flex items-start gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
          <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{transcript}</p>
          <button
            onClick={handleSend}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors"
            aria-label="Send transcript"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      )}

      {/* TTS toggle */}
      <button
        onClick={() => {
          if (ttsPlaying && synthRef.current) synthRef.current.cancel()
          setTtsEnabled(e => !e)
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
          ttsEnabled
            ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
        }`}
        aria-label={ttsEnabled ? 'Disable voice output' : 'Enable voice output'}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
        {ttsEnabled ? (ttsPlaying ? 'Speaking...' : 'Voice on') : 'Voice off'}
      </button>
    </div>
  )
}
