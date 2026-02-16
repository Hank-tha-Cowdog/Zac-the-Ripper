import { create } from 'zustand'
import { cleanDiscTitle } from '../utils/title-utils'

interface DriveInfo {
  index: number
  name: string
  devicePath: string
  discTitle: string | null
  discType: string | null
}

interface TrackInfo {
  id: number
  title: string
  duration: string
  durationSeconds: number
  size: string
  sizeBytes: number
  chapters: number
  resolution: string
  framerate: string
  isInterlaced: boolean
  audioTracks: Array<{
    id: number
    codec: string
    language: string
    channels: string
    bitrate: string
  }>
  subtitleTracks: Array<{
    id: number
    type: string
    language: string
    codec: string
  }>
}

interface DiscInfo {
  title: string
  discType: string
  discId: string
  fingerprint: string
  trackCount: number
  tracks: TrackInfo[]
  metadata: Record<string, string>
}

export interface TMDBResult {
  id: number
  title: string
  year: string
  poster_path: string | null
  overview: string
  vote_average: number
  belongs_to_collection?: { id: number; name: string } | null
}

export interface MusicTrackMeta {
  number: number
  title: string
  artist: string
}

export interface DiscSessionState {
  sessionDiscId: string | null
  kodiTitle: string
  kodiYear: string
  kodiTmdbId: number | null
  kodiSetName: string
  kodiSetOverview: string
  // Music fields (audio CD)
  musicArtist: string
  musicAlbumArtist: string
  musicAlbum: string
  musicYear: string
  musicDiscNumber: number
  musicTotalDiscs: number
  musicTracks: MusicTrackMeta[]
  musicMbReleaseId: string | null
  musicIsVariousArtists: boolean
  musicCoverArtPath: string | null
}

const DEFAULT_DISC_SESSION: DiscSessionState = {
  sessionDiscId: null,
  kodiTitle: '',
  kodiYear: '',
  kodiTmdbId: null,
  kodiSetName: '',
  kodiSetOverview: '',
  musicArtist: '',
  musicAlbumArtist: '',
  musicAlbum: '',
  musicYear: '',
  musicDiscNumber: 1,
  musicTotalDiscs: 1,
  musicTracks: [],
  musicMbReleaseId: null,
  musicIsVariousArtists: false,
  musicCoverArtPath: null
}

interface DiscState {
  drives: DriveInfo[]
  selectedDrive: number | null
  discInfo: DiscInfo | null
  selectedTracks: number[]
  trackCategories: Record<number, string>
  trackNames: Record<number, string>
  scanning: boolean
  loading: boolean
  tmdbResult: TMDBResult | null
  discSession: DiscSessionState

  setDrives: (drives: DriveInfo[]) => void
  setSelectedDrive: (index: number | null) => void
  setDiscInfo: (info: DiscInfo | null) => void
  setSelectedTracks: (trackIds: number[]) => void
  toggleTrack: (trackId: number) => void
  selectAllTracks: () => void
  selectMainFeature: () => void
  setTrackCategory: (trackId: number, category: string) => void
  setTrackName: (trackId: number, name: string) => void
  setScanning: (v: boolean) => void
  setLoading: (v: boolean) => void
  setTmdbResult: (result: TMDBResult | null) => void
  updateDiscSession: (updates: Partial<DiscSessionState>) => void
  resetDiscSession: () => void
}

export const useDiscStore = create<DiscState>((set, get) => ({
  drives: [],
  selectedDrive: null,
  discInfo: null,
  selectedTracks: [],
  trackCategories: {},
  trackNames: {},
  scanning: false,
  loading: false,
  tmdbResult: null,
  discSession: { ...DEFAULT_DISC_SESSION },

  setDrives: (drives) => {
    console.log(`[disc-store] setDrives: ${drives.length} drive(s)`, drives.map(d => ({ i: d.index, title: d.discTitle, type: d.discType })))
    set({ drives })
  },
  setSelectedDrive: (index) => {
    console.log(`[disc-store] setSelectedDrive: ${index}`)
    set({ selectedDrive: index })
  },
  setDiscInfo: (info) => {
    const prev = get().discInfo
    const discChanged = !prev || prev.fingerprint !== info?.fingerprint
    console.log(`[disc-store] setDiscInfo: title="${info?.title}" type=${info?.discType} tracks=${info?.trackCount} fingerprint="${info?.fingerprint}" discChanged=${discChanged}`)

    set({ discInfo: info })

    // Auto-select the main feature (longest track) instead of all tracks
    if (info && info.tracks.length > 0) {
      const longest = info.tracks.reduce((a, b) =>
        a.durationSeconds > b.durationSeconds ? a : b
      )
      set({ selectedTracks: [longest.id] })
    }

    // Reset TMDB + disc session when disc changes — but preserve if session is bound to this disc
    if (discChanged) {
      const { discSession } = get()
      const sessionBoundToThisDisc = discSession.sessionDiscId !== null
        && (discSession.sessionDiscId === info?.discId || discSession.sessionDiscId === '__user_pending__')

      if (sessionBoundToThisDisc) {
        // Upgrade pending sentinel to actual discId
        if (discSession.sessionDiscId === '__user_pending__' && info?.discId) {
          console.log(`[disc-store] Upgrading sessionDiscId from __user_pending__ to "${info.discId}"`)
          set((s) => ({ discSession: { ...s.discSession, sessionDiscId: info.discId } }))
        } else {
          console.log(`[disc-store] Disc changed but session bound to this disc — preserving`)
        }
      } else {
        // Genuinely new disc — reset session
        const cleaned = info ? cleanDiscTitle(info.title) : ''
        console.log(`[disc-store] Disc changed — resetting session, kodiTitle="${cleaned}"`)

        if (info?.discType === 'AUDIO_CD') {
          // Audio CD: populate music fields, skip TMDB
          set({
            tmdbResult: null,
            trackCategories: {},
            trackNames: {},
            discSession: {
              ...DEFAULT_DISC_SESSION,
              sessionDiscId: info.discId,
              musicAlbum: cleaned || 'Audio CD',
              musicTracks: info.tracks.map(t => ({
                number: t.id + 1, // Back to 1-based
                title: t.title,
                artist: ''
              }))
            }
          })
        } else {
          set({
            tmdbResult: null,
            trackCategories: {},
            trackNames: {},
            discSession: {
              ...DEFAULT_DISC_SESSION,
              kodiTitle: cleaned
            }
          })
        }
      }
    }
  },
  setSelectedTracks: (trackIds) => set({ selectedTracks: trackIds }),
  toggleTrack: (trackId) => {
    const { selectedTracks } = get()
    if (selectedTracks.includes(trackId)) {
      set({ selectedTracks: selectedTracks.filter((id) => id !== trackId) })
    } else {
      set({ selectedTracks: [...selectedTracks, trackId] })
    }
  },
  selectAllTracks: () => {
    const { discInfo } = get()
    if (discInfo) {
      set({ selectedTracks: discInfo.tracks.map((t) => t.id) })
    }
  },
  selectMainFeature: () => {
    const { discInfo } = get()
    if (discInfo && discInfo.tracks.length > 0) {
      // Select the longest track (likely the main feature)
      const longest = discInfo.tracks.reduce((a, b) =>
        a.durationSeconds > b.durationSeconds ? a : b
      )
      set({ selectedTracks: [longest.id] })
    }
  },
  setTrackCategory: (trackId, category) =>
    set((state) => ({ trackCategories: { ...state.trackCategories, [trackId]: category } })),
  setTrackName: (trackId, name) =>
    set((state) => ({ trackNames: { ...state.trackNames, [trackId]: name } })),
  setScanning: (scanning) => set({ scanning }),
  setLoading: (loading) => set({ loading }),
  setTmdbResult: (tmdbResult) => set({ tmdbResult }),
  updateDiscSession: (updates) =>
    set((state) => ({ discSession: { ...state.discSession, ...updates } })),
  resetDiscSession: () => set({ tmdbResult: null, discSession: { ...DEFAULT_DISC_SESSION } })
}))
