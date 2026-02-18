"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

type SoundId = "coin" | "fireball" | "footsteps" | "goomba" | "jump";
type OneShotSoundId = Exclude<SoundId, "footsteps">;
type MusicTrackId = "day" | "night";

const SOUND_PATH_BY_ID: Record<SoundId, string> = {
  coin: "/sounds/coin.mp3",
  fireball: "/sounds/fireball.mp3",
  footsteps: "/sounds/footsteps.mp3",
  goomba: "/sounds/goomba.mp3",
  jump: "/sounds/jump.mp3",
};
const MUSIC_PATH_BY_ID: Record<MusicTrackId, string> = {
  day: "/music/day.mp3",
  night: "/music/night.mp3",
};

const ONE_SHOT_GAIN: Record<OneShotSoundId, number> = {
  coin: 0.58,
  fireball: 0.5,
  goomba: 0.6,
  jump: 0.62,
};

const FOOTSTEPS_GAIN = 0.26;
const MASTER_GAIN = 0.92;
const MUSIC_GAIN = 0.4;

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export interface GameAudioController {
  playCoin: () => void;
  playFireball: () => void;
  playJump: () => void;
  playGoombaDefeated: () => void;
  setFootstepsActive: (isActive: boolean) => void;
  setDayNightMusicBlend: (nightFactor: number) => void;
}

export function useGameAudio(): GameAudioController {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const decodedBuffersRef = useRef<Map<SoundId, AudioBuffer>>(new Map());
  const bufferLoadByIdRef = useRef<Map<SoundId, Promise<AudioBuffer | null>>>(
    new Map(),
  );
  const footstepsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const footstepsGainRef = useRef<GainNode | null>(null);
  const footstepsActiveRef = useRef(false);
  const dayMusicRef = useRef<HTMLAudioElement | null>(null);
  const nightMusicRef = useRef<HTMLAudioElement | null>(null);
  const musicNightFactorRef = useRef(0);

  const ensureAudioGraph = useCallback(() => {
    if (audioContextRef.current && masterGainRef.current) {
      return audioContextRef.current;
    }

    const AudioContextCtor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    const context = new AudioContextCtor();
    const masterGain = context.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(context.destination);

    audioContextRef.current = context;
    masterGainRef.current = masterGain;
    return context;
  }, []);

  const unlockAudio = useCallback(async () => {
    const context = ensureAudioGraph();
    if (!context) {
      return;
    }
    if (context.state === "suspended") {
      await context.resume();
    }
  }, [ensureAudioGraph]);

  const loadBuffer = useCallback(
    (soundId: SoundId) => {
      const cached = decodedBuffersRef.current.get(soundId);
      if (cached) {
        return Promise.resolve(cached);
      }

      const inFlight = bufferLoadByIdRef.current.get(soundId);
      if (inFlight) {
        return inFlight;
      }

      const loadPromise = (async () => {
        const context = ensureAudioGraph();
        if (!context) {
          return null;
        }

        try {
          const response = await fetch(SOUND_PATH_BY_ID[soundId]);
          if (!response.ok) {
            return null;
          }
          const encodedBytes = await response.arrayBuffer();
          const decoded = await context.decodeAudioData(encodedBytes.slice(0));
          decodedBuffersRef.current.set(soundId, decoded);
          return decoded;
        } catch {
          return null;
        }
      })();

      bufferLoadByIdRef.current.set(soundId, loadPromise);
      return loadPromise;
    },
    [ensureAudioGraph],
  );

  const playOneShot = useCallback(
    (soundId: OneShotSoundId) => {
      void unlockAudio();
      void loadBuffer(soundId).then((buffer) => {
        if (!buffer) {
          return;
        }

        const context = audioContextRef.current;
        const masterGain = masterGainRef.current;
        if (!context || !masterGain) {
          return;
        }

        const source = context.createBufferSource();
        source.buffer = buffer;

        const gain = context.createGain();
        gain.gain.value = ONE_SHOT_GAIN[soundId];

        source.connect(gain);
        gain.connect(masterGain);
        source.start();
      });
    },
    [loadBuffer, unlockAudio],
  );

  const stopFootsteps = useCallback(() => {
    const source = footstepsSourceRef.current;
    const context = audioContextRef.current;
    const gain = footstepsGainRef.current;
    footstepsSourceRef.current = null;
    footstepsGainRef.current = null;

    if (!source) {
      return;
    }

    try {
      if (context && gain) {
        const now = context.currentTime;
        const stopAt = now + 0.03;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, stopAt);
        source.stop(stopAt);
      } else {
        source.stop();
      }
    } catch {
      // Ignore stop race when source already ended.
    }
  }, []);

  const startFootsteps = useCallback(() => {
    if (footstepsSourceRef.current) {
      return;
    }

    void unlockAudio();
    void loadBuffer("footsteps").then((buffer) => {
      if (!buffer || !footstepsActiveRef.current || footstepsSourceRef.current) {
        return;
      }

      const context = audioContextRef.current;
      const masterGain = masterGainRef.current;
      if (!context || !masterGain) {
        return;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = context.createGain();
      gain.gain.value = FOOTSTEPS_GAIN;

      source.connect(gain);
      gain.connect(masterGain);
      source.start();

      footstepsSourceRef.current = source;
      footstepsGainRef.current = gain;

      source.onended = () => {
        if (footstepsSourceRef.current === source) {
          footstepsSourceRef.current = null;
          footstepsGainRef.current = null;
        }
      };
    });
  }, [loadBuffer, unlockAudio]);

  const setFootstepsActive = useCallback(
    (isActive: boolean) => {
      if (footstepsActiveRef.current === isActive) {
        return;
      }

      footstepsActiveRef.current = isActive;
      if (isActive) {
        startFootsteps();
      } else {
        stopFootsteps();
      }
    },
    [startFootsteps, stopFootsteps],
  );

  const ensureMusicTracks = useCallback(() => {
    if (dayMusicRef.current && nightMusicRef.current) {
      return;
    }

    const dayTrack = new Audio(MUSIC_PATH_BY_ID.day);
    dayTrack.preload = "auto";
    dayTrack.loop = true;

    const nightTrack = new Audio(MUSIC_PATH_BY_ID.night);
    nightTrack.preload = "auto";
    nightTrack.loop = true;

    dayMusicRef.current = dayTrack;
    nightMusicRef.current = nightTrack;
  }, []);

  const syncMusicVolumes = useCallback(() => {
    const dayTrack = dayMusicRef.current;
    const nightTrack = nightMusicRef.current;
    if (!dayTrack || !nightTrack) {
      return;
    }

    const clampedNightFactor = Math.max(0, Math.min(1, musicNightFactorRef.current));
    dayTrack.volume = MUSIC_GAIN * (1 - clampedNightFactor);
    nightTrack.volume = MUSIC_GAIN * clampedNightFactor;
  }, []);

  const resumeMusicPlayback = useCallback(() => {
    ensureMusicTracks();
    syncMusicVolumes();

    const dayTrack = dayMusicRef.current;
    const nightTrack = nightMusicRef.current;
    if (!dayTrack || !nightTrack) {
      return;
    }

    void dayTrack.play().catch(() => {});
    void nightTrack.play().catch(() => {});
  }, [ensureMusicTracks, syncMusicVolumes]);

  const setDayNightMusicBlend = useCallback(
    (nightFactor: number) => {
      musicNightFactorRef.current = nightFactor;
      ensureMusicTracks();
      syncMusicVolumes();
    },
    [ensureMusicTracks, syncMusicVolumes],
  );

  useEffect(() => {
    const warmAudio = () => {
      void unlockAudio();
      void loadBuffer("coin");
      void loadBuffer("fireball");
      void loadBuffer("footsteps");
      void loadBuffer("goomba");
      void loadBuffer("jump");
      resumeMusicPlayback();
    };

    window.addEventListener("pointerdown", warmAudio, { passive: true });
    window.addEventListener("keydown", warmAudio);
    return () => {
      window.removeEventListener("pointerdown", warmAudio);
      window.removeEventListener("keydown", warmAudio);
    };
  }, [loadBuffer, resumeMusicPlayback, unlockAudio]);

  useEffect(() => {
    return () => {
      footstepsActiveRef.current = false;
      stopFootsteps();

      const context = audioContextRef.current;
      audioContextRef.current = null;
      masterGainRef.current = null;
      const dayTrack = dayMusicRef.current;
      const nightTrack = nightMusicRef.current;
      dayMusicRef.current = null;
      nightMusicRef.current = null;
      if (dayTrack) {
        dayTrack.pause();
        dayTrack.src = "";
      }
      if (nightTrack) {
        nightTrack.pause();
        nightTrack.src = "";
      }
      if (context) {
        void context.close();
      }
    };
  }, [stopFootsteps]);

  return useMemo(
    () => ({
      playCoin: () => playOneShot("coin"),
      playFireball: () => playOneShot("fireball"),
      playJump: () => playOneShot("jump"),
      playGoombaDefeated: () => playOneShot("goomba"),
      setFootstepsActive,
      setDayNightMusicBlend,
    }),
    [playOneShot, setDayNightMusicBlend, setFootstepsActive],
  );
}
