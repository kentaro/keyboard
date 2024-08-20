'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WebMidi } from 'webmidi';
import type { Input, NoteMessageEvent } from 'webmidi';

interface ExtendedNoteMessageEvent extends NoteMessageEvent {
  velocity: number;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const PianoKeyboard = () => {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [displayText, setDisplayText] = useState<string>('');
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<number, OscillatorNode>>(new Map());

  const noteNames = useMemo(() => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], []);

  const getNoteOrChordName = useCallback((notes: number[]): string => {
    if (notes.length === 0) return '';
    if (notes.length === 1) {
      const noteName = noteNames[notes[0] % 12];
      const octave = Math.floor(notes[0] / 12) - 1;
      return `${noteName}${octave}`;
    }

    const sortedNotes = [...notes].sort((a, b) => a - b);
    const intervals = sortedNotes.map(note => (note - sortedNotes[0] + 12) % 12);
    const uniqueIntervals = Array.from(new Set(intervals)).sort((a, b) => a - b);

    const getChordType = (ints: number[]): [string, number] => {
      const chordTypes = [
        ['', [0, 4, 7]],
        ['m', [0, 3, 7]],
        ['dim', [0, 3, 6]],
        ['aug', [0, 4, 8]],
        ['sus4', [0, 5, 7]],
        ['sus2', [0, 2, 7]],
        ['7', [0, 4, 7, 10]],
        ['m7', [0, 3, 7, 10]],
        ['maj7', [0, 4, 7, 11]],
        ['m(maj7)', [0, 3, 7, 11]],
        ['dim7', [0, 3, 6, 9]],
        ['6', [0, 4, 7, 9]],
        ['m6', [0, 3, 7, 9]],
      ];

      for (let i = 0; i < ints.length; i++) {
        const shiftedIntervals = ints.map(int => (int - ints[i] + 12) % 12).sort((a, b) => a - b);
        for (const [type, pattern] of chordTypes) {
          if (pattern.every(int => shiftedIntervals.includes(int)) && 
              shiftedIntervals.every(int => pattern.includes(int))) {
            return [type, i];
          }
        }
      }
      return ['?', 0];
    };

    const [chordType, rootOffset] = getChordType(uniqueIntervals);
    const rootIndex = (sortedNotes[0] + uniqueIntervals[rootOffset]) % 12;
    const bassIndex = notes[0] % 12;
    const rootName = noteNames[rootIndex];
    const bassName = noteNames[bassIndex];

    if (bassIndex !== rootIndex && chordType !== '?') {
      return `${rootName}${chordType}/${bassName}`;
    }

    return `${rootName}${chordType}`;
  }, [noteNames]);

  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = (window.AudioContext || window.webkitAudioContext) as typeof AudioContext;
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, []);

  const playNote = useCallback((note: number) => {
    if (!audioContextRef.current) return;
    initializeAudioContext();

    const freq = 440 * (2 ** ((note - 69) / 12));
    const osc = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContextRef.current.currentTime);
    osc.connect(gain);
    gain.connect(audioContextRef.current.destination);

    gain.gain.setValueAtTime(0.5, audioContextRef.current.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.5);

    osc.start();
    oscillatorsRef.current.set(note, osc);

    setTimeout(() => {
      osc.stop();
      oscillatorsRef.current.delete(note);
    }, 500);
  }, [initializeAudioContext]);

  const stopNote = useCallback((note: number) => {
    const osc = oscillatorsRef.current.get(note);
    if (osc) {
      osc.stop();
      oscillatorsRef.current.delete(note);
    }
  }, []);

  const handleMIDIMessage = useCallback((event: WebMidi.MIDIMessageEvent) => {
    const [status, note, velocity] = event.data;
    if (status === 144 && velocity > 0) {
      setActiveNotes(prev => {
        const newNotes = new Set(prev);
        newNotes.add(note);
        setDisplayText(getNoteOrChordName(Array.from(newNotes)));
        return newNotes;
      });
      playNote(note);
    } else if (status === 128 || (status === 144 && velocity === 0)) {
      setActiveNotes(prev => {
        const newNotes = new Set(prev);
        newNotes.delete(note);
        setDisplayText(getNoteOrChordName(Array.from(newNotes)));
        return newNotes;
      });
      stopNote(note);
    }
  }, [getNoteOrChordName, playNote, stopNote]);

  useEffect(() => {
    const handleGlobalClick = () => {
      initializeAudioContext();
      document.removeEventListener('click', handleGlobalClick);
    };

    document.addEventListener('click', handleGlobalClick);

    const setupMIDI = async () => {
      try {
        await WebMidi.enable();
        setMidiDevices(WebMidi.inputs.map(input => input.name));
        for (const input of WebMidi.inputs) {
          input.addListener('noteon', handleMIDIMessage);
          input.addListener('noteoff', handleMIDIMessage);
        }
      } catch (err) {
        console.error('MIDI アクセスが拒否されました:', err);
      }
    };

    setupMIDI();

    return () => {
      WebMidi.disable();
      audioContextRef.current?.close();
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [handleMIDIMessage, initializeAudioContext]);

  const pianoKeys = useMemo(() => {
    return Array.from({ length: 88 }, (_, i) => i + 21).map((noteNumber) => {
      const isWhiteKey = [0, 2, 4, 5, 7, 9, 11].includes(noteNumber % 12);
      return (
        <div
          key={noteNumber}
          className={`
            ${isWhiteKey ? 'w-6 h-36' : 'w-4 h-24 -mx-2 z-10'}
            ${activeNotes.has(noteNumber) ? (isWhiteKey ? 'bg-blue-300' : 'bg-blue-500') : (isWhiteKey ? 'bg-white' : 'bg-black')}
            border border-gray-300 cursor-pointer
          `}
          onMouseDown={() => {
            setActiveNotes(prev => {
              const newNotes = new Set(prev);
              newNotes.add(noteNumber);
              setDisplayText(getNoteOrChordName(Array.from(newNotes)));
              return newNotes;
            });
            playNote(noteNumber);
          }}
          onMouseUp={() => {
            setActiveNotes(prev => {
              const newNotes = new Set(prev);
              newNotes.delete(noteNumber);
              setDisplayText(getNoteOrChordName(Array.from(newNotes)));
              return newNotes;
            });
            stopNote(noteNumber);
          }}
          onMouseLeave={() => {
            if (activeNotes.has(noteNumber)) {
              setActiveNotes(prev => {
                const newNotes = new Set(prev);
                newNotes.delete(noteNumber);
                setDisplayText(getNoteOrChordName(Array.from(newNotes)));
                return newNotes;
              });
              stopNote(noteNumber);
            }
          }}
        />
      );
    });
  }, [activeNotes, playNote, stopNote, getNoteOrChordName]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">認識されたMIDIデバイス:</h2>
        {midiDevices.length > 0 ? (
          <ul>
            {midiDevices.map((device) => (
              <li key={device}>{device}</li>
            ))}
          </ul>
        ) : (
          <p>MIDIデバイスが見つかりません。</p>
        )}
      </div>
      <div className="w-full h-40 bg-gray-200 flex items-start overflow-x-auto">
        {pianoKeys}
      </div>
      <div className="h-24 flex items-center justify-center">
        <div className="text-6xl font-bold text-center min-h-[1.2em]">
          {displayText || '\u00A0'}
        </div>
      </div>
    </div>
  );
};

export default PianoKeyboard;