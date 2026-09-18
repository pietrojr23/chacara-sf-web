import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types/navigation';
import { useAuth } from '../../contexts/AuthContext';
import {
  getAllUsers,
  getPrivateChatThreadById,
  markChatMessageAsRead,
  sendChatMessage,
  setPrivateChatThreadStatus,
  subscribeGeneralMessages,
  subscribePrivateMessages,
  updatePrivateChatThreadTitle,
} from '../../services/firestoreService';
import { setActiveChatNotificationContext } from '../../services/notificationService';
import { uploadFileAsync, uploadImageAsync } from '../../services/storageService';
import {
  improveChatDraftWithGroq,
  suggestChatTopicTitleWithGroq,
  suggestChatReplyWithGroq,
  summarizeChatWithGroq,
  type ChatAiContextMessage,
} from '../../services/groqService';
import { ChatMessage } from '../../types/models';
import { palette, radii, spacing } from '../../constants/theme';
import { formatDateBR } from '../../utils/format';
import { getFileExtension, getFileNameFromPath, inferFileKind } from '../../utils/file';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;
type ReplyPayload = NonNullable<ChatMessage['replyTo']>;

const SEND_SOUND = require('../../../assets/sounds/chat-send.wav');
const RECEIVE_SOUND = require('../../../assets/sounds/chat-receive.wav');
const AUTO_CHAT_TITLE_MIN_MESSAGES = 5;

const areMessageListsEquivalent = (current: ChatMessage[], next: ChatMessage[]) => {
  if (current === next) {
    return true;
  }

  if (current.length !== next.length) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];

    if (
      left.id !== right.id
      || left.enviadoEm !== right.enviadoEm
      || left.texto !== right.texto
      || left.imagemUrl !== right.imagemUrl
      || left.audioUrl !== right.audioUrl
      || left.audioDurationMs !== right.audioDurationMs
      || left.enviadoPor !== right.enviadoPor
      || left.enviadoPorNome !== right.enviadoPorNome
      || (left.lidoPor?.length ?? 0) !== (right.lidoPor?.length ?? 0)
      || left.replyTo?.messageId !== right.replyTo?.messageId
    ) {
      return false;
    }
  }

  return true;
};

export const ChatRoomScreen = ({ route, navigation }: Props) => {
  const { chatId, title, isPrivate = false } = route.params;
  const { profile } = useAuth();
  const isPrincipalPrivateThread = isPrivate && !chatId.includes('__');
  const chatSubtitle = !isPrivate
    ? 'Grupo geral da chácara'
    : isPrincipalPrivateThread
      ? 'Conversa privada'
      : 'Conversa por assunto';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [playingAudioMessageId, setPlayingAudioMessageId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [userPhotoById, setUserPhotoById] = useState<Record<string, string>>({});
  const [privateThreadStatus, setPrivateThreadStatus] = useState<'aberto' | 'concluido'>('aberto');
  const [privateThreadTitle, setPrivateThreadTitle] = useState(title);
  const [privateThreadAutoTitleGenerated, setPrivateThreadAutoTitleGenerated] = useState(false);
  const [updatingThreadStatus, setUpdatingThreadStatus] = useState(false);

  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const sendSoundRef = useRef<Audio.Sound | null>(null);
  const receiveSoundRef = useRef<Audio.Sound | null>(null);
  const lastKnownMessageIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitialScrollRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const playbackSoundRef = useRef<Audio.Sound | null>(null);
  const pendingReadMessageIdsRef = useRef<Set<string>>(new Set());
  const autoTitleInFlightRef = useRef(false);

  useEffect(() => {
    const applyMessages = (nextMessages: ChatMessage[]) => {
      setMessages((currentMessages) =>
        areMessageListsEquivalent(currentMessages, nextMessages) ? currentMessages : nextMessages);
    };

    const unsubscribe = isPrivate
      ? subscribePrivateMessages(chatId, applyMessages)
      : subscribeGeneralMessages(applyMessages);

    return unsubscribe;
  }, [chatId, isPrivate]);

  useEffect(() => {
    setActiveChatNotificationContext({ chatId, isPrivate });
    return () => {
      setActiveChatNotificationContext(null);
    };
  }, [chatId, isPrivate]);

  useEffect(() => {
    setReplyingTo(null);
    setHighlightedMessageId(null);
    setShowAttachMenu(false);
    lastKnownMessageIdRef.current = null;
    didInitialScrollRef.current = false;
    if (recording) {
      void recording.stopAndUnloadAsync();
    }
    setRecording(null);
    setIsRecording(false);
    recordingStartedAtRef.current = null;
    setPrivateThreadTitle(title);
    setPrivateThreadStatus('aberto');
    setPrivateThreadAutoTitleGenerated(false);
    autoTitleInFlightRef.current = false;
  }, [chatId]);

  useEffect(() => {
    setPrivateThreadTitle(title);
  }, [title]);

  useEffect(() => {
    if (!isPrivate || isPrincipalPrivateThread) {
      setPrivateThreadStatus('aberto');
      setPrivateThreadAutoTitleGenerated(false);
      return undefined;
    }

    let active = true;

    const syncThreadMeta = async () => {
      try {
        const meta = await getPrivateChatThreadById(chatId);
        if (!active) {
          return;
        }

        if (meta?.title) {
          setPrivateThreadTitle(meta.title);
        }
        setPrivateThreadStatus(meta?.status === 'concluido' ? 'concluido' : 'aberto');
        setPrivateThreadAutoTitleGenerated(Boolean(meta?.autoTitleGenerated));
      } catch {
        if (active) {
          setPrivateThreadStatus('aberto');
          setPrivateThreadAutoTitleGenerated(false);
        }
      }
    };

    void syncThreadMeta();
    const interval = setInterval(() => {
      void syncThreadMeta();
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [chatId, isPrivate, isPrincipalPrivateThread]);

  useEffect(() => {
    if (!isPrivate || isPrincipalPrivateThread || profile?.isOwner) {
      return;
    }

    if (privateThreadStatus !== 'concluido') {
      return;
    }

    Alert.alert('Chat concluído', 'Este chat foi concluído e não está disponível para inquilinos.');
    navigation.goBack();
  }, [isPrivate, isPrincipalPrivateThread, navigation, privateThreadStatus, profile?.isOwner]);

  useEffect(() => {
    let active = true;

    getAllUsers()
      .then((users) => {
        if (!active) {
          return;
        }

        const photoMap = users.reduce<Record<string, string>>((acc, user) => {
          if (user.photoURL) {
            acc[user.id] = user.photoURL;
          }
          return acc;
        }, {});

        setUserPhotoById(photoMap);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm)), [messages]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    const unreadCandidates = sorted
      .filter((message) => message.enviadoPor !== profile.id && !message.lidoPor?.includes(profile.id))
      .slice(-24);

    if (!unreadCandidates.length) {
      return;
    }

    const pendingSet = pendingReadMessageIdsRef.current;
    const targets = unreadCandidates.filter((message) => !pendingSet.has(message.id));
    if (!targets.length) {
      return;
    }

    targets.forEach((message) => pendingSet.add(message.id));
    let cancelled = false;

    void Promise.allSettled(
      targets.map((message) =>
        markChatMessageAsRead({
          chatId: message.chatId || chatId,
          isPrivate,
          messageId: message.id,
          userId: profile.id,
        }),
      ),
    ).finally(() => {
      if (cancelled) {
        return;
      }
      targets.forEach((message) => pendingSet.delete(message.id));
    });

    return () => {
      cancelled = true;
      targets.forEach((message) => pendingSet.delete(message.id));
    };
  }, [chatId, isPrivate, profile, sorted]);

  const messageIndexById = useMemo(() => {
    const indexMap = new Map<string, number>();
    sorted.forEach((message, index) => {
      indexMap.set(message.id, index);
    });
    return indexMap;
  }, [sorted]);

  const getPreviewText = useCallback((params: { text?: string | null; imageUrl?: string | null; audioUrl?: string | null }) => {
    const text = String(params.text ?? '').trim();
    if (text) {
      return text;
    }

    const imageUrl = String(params.imageUrl ?? '').trim();
    const audioUrl = String(params.audioUrl ?? '').trim();
    if (audioUrl) {
      return 'Áudio';
    }

    if (!imageUrl) {
      return 'Mensagem';
    }

    return inferFileKind(imageUrl) === 'image' ? 'Imagem' : 'Arquivo';
  }, []);

  const scrollToBottom = useCallback((animated = true, delayMs = 0) => {
    const run = () => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated });
      });
    };

    if (delayMs > 0) {
      setTimeout(run, delayMs);
      return;
    }

    run();
  }, []);

  const forceScrollToBottom = useCallback((animated = false) => {
    scrollToBottom(animated, 0);
    scrollToBottom(animated, 70);
    scrollToBottom(animated, 150);
  }, [scrollToBottom]);

  useEffect(() => {
    if (!sorted.length) {
      return;
    }

    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      forceScrollToBottom(false);
      return;
    }

    forceScrollToBottom(true);
  }, [forceScrollToBottom, sorted.length]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      forceScrollToBottom(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      forceScrollToBottom(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [forceScrollToBottom]);

  useEffect(() => {
    let active = true;

    const loadSounds = async () => {
      try {
        const [sendResult, receiveResult] = await Promise.all([
          Audio.Sound.createAsync(SEND_SOUND, { shouldPlay: false }),
          Audio.Sound.createAsync(RECEIVE_SOUND, { shouldPlay: false }),
        ]);

        if (!active) {
          await sendResult.sound.unloadAsync();
          await receiveResult.sound.unloadAsync();
          return;
        }

        sendSoundRef.current = sendResult.sound;
        receiveSoundRef.current = receiveResult.sound;
      } catch {
        sendSoundRef.current = null;
        receiveSoundRef.current = null;
      }
    };

    void loadSounds();

    return () => {
      active = false;
      if (sendSoundRef.current) {
        void sendSoundRef.current.unloadAsync();
      }
      if (receiveSoundRef.current) {
        void receiveSoundRef.current.unloadAsync();
      }
      sendSoundRef.current = null;
      receiveSoundRef.current = null;
    };
  }, []);

  const playSound = useCallback(async (sound: Audio.Sound | null) => {
    if (!sound) {
      return;
    }

    try {
      await sound.replayAsync();
    } catch {
      // Sem bloqueio: feedback sonoro é opcional.
    }
  }, []);

  useEffect(() => {
    if (!profile || !sorted.length) {
      return;
    }

    const lastMessage = sorted[sorted.length - 1];
    const previousMessageId = lastKnownMessageIdRef.current;

    if (!previousMessageId) {
      lastKnownMessageIdRef.current = lastMessage.id;
      return;
    }

    if (lastMessage.id === previousMessageId) {
      return;
    }

    lastKnownMessageIdRef.current = lastMessage.id;

    if (lastMessage.enviadoPor !== profile.id) {
      void playSound(receiveSoundRef.current);
    }
    forceScrollToBottom(true);
  }, [forceScrollToBottom, playSound, profile, sorted]);

  const buildReplyPayload = useCallback((): ReplyPayload | null => {
    if (!replyingTo) {
      return null;
    }

    const text = String(replyingTo.texto ?? '').trim();
    const imageUrl = String(replyingTo.imagemUrl ?? '').trim();
    const audioUrl = String(replyingTo.audioUrl ?? '').trim();

    return {
      messageId: replyingTo.id,
      senderId: replyingTo.enviadoPor,
      senderName: replyingTo.enviadoPorNome,
      text: text || undefined,
      imageUrl: imageUrl || undefined,
      audioUrl: audioUrl || undefined,
    };
  }, [replyingTo]);

  const getSenderPhotoUrl = useCallback(
    (message: ChatMessage) => {
      if (message.enviadoPor === profile?.id) {
        return profile.photoURL ?? message.enviadoPorFotoURL;
      }

      return userPhotoById[message.enviadoPor] ?? message.enviadoPorFotoURL;
    },
    [profile, userPhotoById],
  );

  const clearReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const highlightMessage = useCallback((messageId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }

    setHighlightedMessageId(messageId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
      highlightTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (playbackSoundRef.current) {
        void playbackSoundRef.current.stopAsync();
        void playbackSoundRef.current.unloadAsync();
      }
      if (recording) {
        void recording.stopAndUnloadAsync();
      }
    };
  }, [recording]);

  const scrollToQuotedMessage = useCallback(
    (messageId: string) => {
      const index = messageIndexById.get(messageId);
      if (typeof index !== 'number') {
        Alert.alert('Mensagem não encontrada', 'A mensagem original não está carregada nesta conversa.');
        return;
      }

      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
      highlightMessage(messageId);
    },
    [highlightMessage, messageIndexById],
  );

  const formatAudioDuration = useCallback((durationMs?: number | null) => {
    const safeMs = Math.max(0, Number(durationMs ?? 0));
    const totalSeconds = Math.max(1, Math.round(safeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, []);

  const unloadPlayback = useCallback(async () => {
    if (!playbackSoundRef.current) {
      return;
    }

    try {
      await playbackSoundRef.current.stopAsync();
    } catch {
      // ignore
    }

    try {
      await playbackSoundRef.current.unloadAsync();
    } catch {
      // ignore
    }

    playbackSoundRef.current = null;
    setPlayingAudioMessageId(null);
  }, []);

  const toggleAudioPlayback = useCallback(
    async (message: ChatMessage) => {
      const audioUrl = String(message.audioUrl ?? '').trim();
      if (!audioUrl) {
        return;
      }

      if (playingAudioMessageId === message.id) {
        await unloadPlayback();
        return;
      }

      await unloadPlayback();

      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          (status: AVPlaybackStatus) => {
            if (!status.isLoaded) {
              return;
            }

            if (status.didJustFinish) {
              void unloadPlayback();
            }
          },
        );

        playbackSoundRef.current = sound;
        setPlayingAudioMessageId(message.id);
      } catch {
        Alert.alert('Erro', 'Não foi possível reproduzir este áudio.');
        await unloadPlayback();
      }
    },
    [playingAudioMessageId, unloadPlayback],
  );

  const stopRecordingIfAny = useCallback(async () => {
    if (!recording) {
      return null;
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const startedAt = recordingStartedAtRef.current ?? Date.now();
      const durationMs = Math.max(1, Date.now() - startedAt);
      return { uri, durationMs };
    } catch {
      return null;
    } finally {
      recordingStartedAtRef.current = null;
      setRecording(null);
      setIsRecording(false);
    }
  }, [recording]);

  const isThreadClosed = isPrivate && !isPrincipalPrivateThread && privateThreadStatus === 'concluido';

  const meaningfulMessageCount = useMemo(
    () =>
      sorted.filter((message) => {
        const hasText = Boolean(String(message.texto ?? '').trim());
        return hasText || Boolean(message.imagemUrl) || Boolean(message.audioUrl);
      }).length,
    [sorted],
  );

  useEffect(() => {
    if (!profile?.isOwner || !isPrivate || isPrincipalPrivateThread) {
      return;
    }

    if (privateThreadAutoTitleGenerated || isThreadClosed) {
      return;
    }

    if (meaningfulMessageCount < AUTO_CHAT_TITLE_MIN_MESSAGES) {
      return;
    }

    if (autoTitleInFlightRef.current) {
      return;
    }

    autoTitleInFlightRef.current = true;
    let cancelled = false;

    const contextMessages: ChatAiContextMessage[] = sorted.slice(-30).map((message) => ({
      senderName: message.enviadoPor === profile.id ? 'Você' : message.enviadoPorNome,
      sentAt: formatDateBR(message.enviadoEm, 'HH:mm'),
      text: String(message.texto ?? '').trim() || undefined,
      hasImage: Boolean(message.imagemUrl),
      hasAudio: Boolean(message.audioUrl),
    }));

    void (async () => {
      try {
        const suggestedTitleRaw = await suggestChatTopicTitleWithGroq({
          currentTitle: privateThreadTitle,
          messages: contextMessages,
        });

        const suggestedTitle = String(suggestedTitleRaw)
          .replace(/^["'“”]+|["'“”]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 64);

        if (!suggestedTitle || suggestedTitle.length < 3) {
          return;
        }

        await updatePrivateChatThreadTitle({
          threadId: chatId,
          title: suggestedTitle,
          actorId: profile.id,
          actorName: profile.nome,
          autoGenerated: true,
          messageCount: meaningfulMessageCount,
        });

        if (cancelled) {
          return;
        }

        setPrivateThreadTitle(suggestedTitle);
        setPrivateThreadAutoTitleGenerated(true);
      } catch (error) {
        if (__DEV__) {
          console.warn('[chat-auto-title] falha ao gerar título automático:', error);
        }
      } finally {
        autoTitleInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    chatId,
    isPrivate,
    isPrincipalPrivateThread,
    isThreadClosed,
    meaningfulMessageCount,
    privateThreadAutoTitleGenerated,
    privateThreadTitle,
    profile,
    sorted,
  ]);

  const ensureThreadIsOpen = useCallback(() => {
    if (!isThreadClosed) {
      return true;
    }

    Alert.alert('Chat concluído', 'Este chat já foi concluído pelo proprietário e está somente leitura.');
    return false;
  }, [isThreadClosed]);

  const handleRecordAudioPress = useCallback(async () => {
    if (!profile || sending) {
      return;
    }

    if (!ensureThreadIsOpen()) {
      return;
    }

    if (isRecording) {
      const finalRecording = await stopRecordingIfAny();
      if (!finalRecording?.uri) {
        return;
      }

      try {
        setSending(true);
        const url = await uploadFileAsync(
          finalRecording.uri,
          `chat/${chatId}/${Date.now()}-${profile.id}.m4a`,
        );

        await sendChatMessage({
          chatId,
          isPrivate,
          audioUrl: url,
          audioDurationMs: finalRecording.durationMs,
          replyTo: buildReplyPayload(),
          senderId: profile.id,
          senderName: profile.nome,
          senderPhotoURL: profile.photoURL ?? undefined,
        });

        setShowAttachMenu(false);
        clearReply();
        void playSound(sendSoundRef.current);
        forceScrollToBottom(true);
      } catch {
        Alert.alert('Erro', 'Não foi possível enviar o áudio.');
      } finally {
        setSending(false);
      }

      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita acesso ao microfone para gravar áudio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const nextRecording = new Audio.Recording();
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await nextRecording.startAsync();
      recordingStartedAtRef.current = Date.now();
      setRecording(nextRecording);
      setIsRecording(true);
    } catch {
      setRecording(null);
      setIsRecording(false);
      recordingStartedAtRef.current = null;
      Alert.alert('Erro', 'Não foi possível iniciar a gravação.');
    }
  }, [
    buildReplyPayload,
    chatId,
    clearReply,
    isPrivate,
    isRecording,
    playSound,
    profile,
    forceScrollToBottom,
    sending,
    ensureThreadIsOpen,
    stopRecordingIfAny,
  ]);

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !profile || sending) {
      return;
    }

    if (!ensureThreadIsOpen()) {
      return;
    }

    try {
      setSending(true);
      await sendChatMessage({
        chatId,
        isPrivate,
        text,
        replyTo: buildReplyPayload(),
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
      setDraft('');
      setShowAttachMenu(false);
      clearReply();
      void playSound(sendSoundRef.current);
      forceScrollToBottom(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  const sendImage = async () => {
    if (!profile || sending) {
      return;
    }

    if (!ensureThreadIsOpen()) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Permita acesso à galeria para enviar imagens.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) {
      return;
    }

    try {
      setSending(true);
      const asset = result.assets[0];
      const uri = asset.uri;
      const ext = getFileExtension(asset.fileName) || getFileExtension(uri) || 'bin';
      const url = await uploadImageAsync(uri, `chat/${chatId}/${Date.now()}-${profile.id}.${ext}`);

      await sendChatMessage({
        chatId,
        isPrivate,
        imageUrl: url,
        replyTo: buildReplyPayload(),
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
      setShowAttachMenu(false);
      clearReply();
      void playSound(sendSoundRef.current);
      forceScrollToBottom(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  };

  const sendFile = async () => {
    if (!profile || sending) {
      return;
    }

    if (!ensureThreadIsOpen()) {
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) {
      return;
    }

    try {
      setSending(true);
      const asset = result.assets[0];
      const ext = getFileExtension(asset.name) || getFileExtension(asset.uri) || 'bin';
      const url = await uploadImageAsync(asset.uri, `chat/${chatId}/${Date.now()}-${profile.id}.${ext}`);

      await sendChatMessage({
        chatId,
        isPrivate,
        imageUrl: url,
        replyTo: buildReplyPayload(),
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
      setShowAttachMenu(false);
      clearReply();
      void playSound(sendSoundRef.current);
      forceScrollToBottom(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  };

  const getAiContextMessages = useCallback((): ChatAiContextMessage[] => {
    return sorted.slice(-24).map((message) => ({
      senderName: message.enviadoPor === profile?.id ? 'Você' : message.enviadoPorNome,
      sentAt: formatDateBR(message.enviadoEm, 'HH:mm'),
      text: String(message.texto ?? '').trim() || undefined,
      hasImage: Boolean(message.imagemUrl),
      hasAudio: Boolean(message.audioUrl),
    }));
  }, [profile?.id, sorted]);

  const runAiAction = useCallback(
    async (action: 'suggest' | 'improve' | 'summary') => {
      if (!profile || aiLoading) {
        return;
      }
      if (!profile.isOwner) {
        Alert.alert('Assistente IA', 'Este recurso está disponível somente para o proprietário.');
        return;
      }

      const contextMessages = getAiContextMessages();
      if (!contextMessages.length) {
        Alert.alert('Assistente IA', 'Ainda não há mensagens suficientes para esta ação.');
        return;
      }

      if (action === 'improve' && !draft.trim()) {
        Alert.alert('Assistente IA', 'Digite uma mensagem para eu melhorar o texto.');
        return;
      }

      try {
        setAiLoading(true);
        setShowAttachMenu(false);

        if (action === 'suggest') {
          const suggestion = await suggestChatReplyWithGroq({
            chatTitle: isPrivate ? privateThreadTitle : title,
            currentUserName: profile.nome,
            messages: contextMessages,
          });
          setDraft(suggestion);
          return;
        }

        if (action === 'improve') {
          const improvedText = await improveChatDraftWithGroq({
            draft: draft.trim(),
            chatTitle: isPrivate ? privateThreadTitle : title,
            currentUserName: profile.nome,
            messages: contextMessages,
          });
          setDraft(improvedText);
          return;
        }

        const summary = await summarizeChatWithGroq({
          chatTitle: isPrivate ? privateThreadTitle : title,
          messages: contextMessages,
        });
        Alert.alert('Resumo da conversa (IA)', summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao usar IA no chat.';
        Alert.alert('Assistente IA', message);
      } finally {
        setAiLoading(false);
      }
    },
    [aiLoading, draft, getAiContextMessages, isPrivate, privateThreadTitle, profile, title],
  );

  const openAiMenu = useCallback(() => {
    if (!profile?.isOwner) {
      Alert.alert('Assistente IA', 'Este recurso está disponível somente para o proprietário.');
      return;
    }
    setShowAttachMenu(false);

    if (isThreadClosed) {
      Alert.alert('Assistente IA', 'Chat concluído: apenas resumo está disponível.', [
        {
          text: 'Resumir conversa',
          onPress: () => {
            void runAiAction('summary');
          },
        },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }

    Alert.alert('Assistente IA', 'Escolha uma ação para este chat.', [
      {
        text: 'Sugerir resposta',
        onPress: () => {
          void runAiAction('suggest');
        },
      },
      {
        text: 'Melhorar texto',
        onPress: () => {
          void runAiAction('improve');
        },
      },
      {
        text: 'Resumir conversa',
        onPress: () => {
          void runAiAction('summary');
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, [isThreadClosed, profile?.isOwner, runAiAction]);

  const handleTogglePrivateThreadStatus = useCallback(() => {
    if (!profile?.isOwner || !isPrivate || isPrincipalPrivateThread || updatingThreadStatus) {
      return;
    }

    const nextStatus = privateThreadStatus === 'concluido' ? 'aberto' : 'concluido';
    const actionLabel = nextStatus === 'concluido' ? 'concluir' : 'reabrir';

    Alert.alert(
      nextStatus === 'concluido' ? 'Concluir chat' : 'Reabrir chat',
      nextStatus === 'concluido'
        ? 'Deseja concluir este chat? Depois disso ele ficará somente leitura até ser reaberto.'
        : 'Deseja reabrir este chat para novas mensagens?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: nextStatus === 'concluido' ? 'Sim, concluir' : 'Sim, reabrir',
          onPress: () => {
            void (async () => {
              try {
                setUpdatingThreadStatus(true);
                await setPrivateChatThreadStatus({
                  threadId: chatId,
                  status: nextStatus,
                  actorId: profile.id,
                  actorName: profile.nome,
                });
                setPrivateThreadStatus(nextStatus);
              } catch {
                Alert.alert('Erro', `Não foi possível ${actionLabel} este chat agora.`);
              } finally {
                setUpdatingThreadStatus(false);
              }
            })();
          },
        },
      ],
    );
  }, [chatId, isPrivate, isPrincipalPrivateThread, privateThreadStatus, profile, updatingThreadStatus]);

  const replyingHeader = useMemo(() => {
    if (!replyingTo) {
      return '';
    }

    if (replyingTo.enviadoPor === profile?.id) {
      return 'Respondendo à sua mensagem';
    }

    return `Respondendo a ${replyingTo.enviadoPorNome}`;
  }, [profile?.id, replyingTo]);

  const canUseChatAi = Boolean(profile?.isOwner);
  const canManagePrivateThread = Boolean(profile?.isOwner && isPrivate && !isPrincipalPrivateThread);
  const canSendText = draft.trim().length > 0 && !sending && !isRecording && !aiLoading && !isThreadClosed;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? -25 : -25}
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={10}
            style={styles.headerBackButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={24} color={palette.gray900} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>{isPrivate ? privateThreadTitle : title}</Text>
            <Text style={styles.subtitle}>{chatSubtitle}</Text>
          </View>
          {isPrivate ? (
            <View style={[styles.threadStatusPill, isThreadClosed ? styles.threadStatusPillClosed : styles.threadStatusPillOpen]}>
              <Text style={styles.threadStatusPillText}>{isThreadClosed ? 'Concluído' : 'Aberto'}</Text>
            </View>
          ) : null}
        </View>

        {canManagePrivateThread ? (
          <Pressable
            style={[styles.manageThreadButton, updatingThreadStatus ? styles.manageThreadButtonDisabled : null]}
            onPress={handleTogglePrivateThreadStatus}
            disabled={updatingThreadStatus}
          >
            <MaterialIcons
              name={isThreadClosed ? 'lock-open' : 'check-circle'}
              size={16}
              color={isThreadClosed ? '#15803D' : '#92400E'}
            />
            <Text style={styles.manageThreadButtonText}>
              {isThreadClosed ? 'Reabrir chat' : 'Concluir chat'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isThreadClosed ? (
        <View style={styles.closedThreadBanner}>
          <MaterialIcons name="lock" size={16} color={palette.gray700} />
          <Text style={styles.closedThreadBannerText}>Chat concluído. Somente leitura.</Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={sorted}
        keyExtractor={(item) => item.id}
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        onLayout={() => forceScrollToBottom(false)}
        onContentSizeChange={() => forceScrollToBottom(false)}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index,
              animated: true,
              viewPosition: 0.5,
            });
          }, 250);
        }}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const mine = item.enviadoPor === profile?.id;
          const senderPhotoUrl = getSenderPhotoUrl(item);
          const wasReadByOther = (item.lidoPor ?? []).some((readerId) => readerId !== item.enviadoPor);
          const replyAuthorLabel = item.replyTo
            ? item.replyTo.senderId === profile?.id
              ? 'Você'
              : item.replyTo.senderName
            : '';

          return (
            <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowTheirs]}>
              {!mine ? (
                <View style={styles.messageAvatarContainer}>
                  {senderPhotoUrl ? (
                    <Image source={{ uri: senderPhotoUrl }} style={styles.messageAvatar} />
                  ) : (
                    <MaterialIcons name="person" size={16} color={palette.gray700} />
                  )}
                </View>
              ) : null}

              <Pressable
                style={[
                  styles.messageBubble,
                  mine ? styles.mine : styles.theirs,
                  item.id === highlightedMessageId ? styles.messageBubbleHighlighted : null,
                ]}
                onLongPress={() => setReplyingTo(item)}
                delayLongPress={220}
              >
                <Text style={styles.author}>{mine ? 'Você' : item.enviadoPorNome}</Text>

                {item.replyTo ? (
                  <Pressable
                    onPress={() => scrollToQuotedMessage(item.replyTo?.messageId ?? '')}
                    style={[styles.replyQuote, mine ? styles.replyQuoteMine : styles.replyQuoteTheirs]}
                  >
                    <Text style={styles.replyAuthor}>{replyAuthorLabel}</Text>
                    <Text style={styles.replyText} numberOfLines={1}>
                      {getPreviewText({
                        text: item.replyTo.text,
                        imageUrl: item.replyTo.imageUrl,
                        audioUrl: item.replyTo.audioUrl,
                      })}
                    </Text>
                  </Pressable>
                ) : null}

                {item.texto ? <Text style={styles.messageText}>{item.texto}</Text> : null}
                {item.audioUrl ? (
                  <Pressable style={styles.audioBubble} onPress={() => toggleAudioPlayback(item)}>
                    <MaterialIcons
                      name={playingAudioMessageId === item.id ? 'pause-circle-filled' : 'play-circle-filled'}
                      size={24}
                      color={palette.greenDark}
                    />
                    <Text style={styles.audioBubbleText}>
                      {playingAudioMessageId === item.id ? 'Pausar áudio' : 'Reproduzir áudio'}
                    </Text>
                    <Text style={styles.audioDuration}>{formatAudioDuration(item.audioDurationMs)}</Text>
                  </Pressable>
                ) : null}
                {item.imagemUrl ? (
                  inferFileKind(item.imagemUrl) === 'image' ? (
                    <Pressable onPress={() => Linking.openURL(item.imagemUrl as string)}>
                      <Image source={{ uri: item.imagemUrl }} style={styles.messageImage} />
                    </Pressable>
                  ) : (
                    <Pressable style={styles.fileBubble} onPress={() => Linking.openURL(item.imagemUrl as string)}>
                      <MaterialIcons name="attach-file" size={18} color={palette.greenDark} />
                      <Text style={styles.fileBubbleText}>{getFileNameFromPath(item.imagemUrl, 'Abrir arquivo')}</Text>
                    </Pressable>
                  )
                ) : null}

                <View style={[styles.messageFooter, !mine ? styles.messageFooterOnlyTime : null]}>
                  <Text style={styles.time}>{formatDateBR(item.enviadoEm, 'HH:mm')}</Text>
                  {mine ? (
                    <MaterialIcons
                      name={wasReadByOther ? 'done-all' : 'done'}
                      size={16}
                      color={wasReadByOther ? '#3B95FF' : palette.gray500}
                    />
                  ) : null}
                </View>
              </Pressable>

              {mine ? (
                <View style={styles.messageAvatarContainer}>
                  {senderPhotoUrl ? (
                    <Image source={{ uri: senderPhotoUrl }} style={styles.messageAvatar} />
                  ) : (
                    <MaterialIcons name="person" size={16} color={palette.gray700} />
                  )}
                </View>
              ) : null}
            </View>
          );
        }}
      />

      <View style={styles.composerContainer}>
        {isThreadClosed ? (
          canUseChatAi ? (
            <View style={styles.closedAiOnlyWrap}>
              <Pressable
                style={[styles.closedAiOnlyButton, aiLoading ? styles.closedAiOnlyButtonDisabled : null]}
                onPress={() => {
                  void runAiAction('summary');
                }}
                disabled={aiLoading}
              >
                {aiLoading ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <MaterialIcons name="auto-awesome" size={18} color={palette.white} />
                )}
                <Text style={styles.closedAiOnlyButtonText}>
                  {aiLoading ? 'Gerando resumo...' : 'Resumir conversa (IA)'}
                </Text>
              </Pressable>
            </View>
          ) : null
        ) : (
          <>
            {replyingTo ? (
              <View style={styles.replyComposer}>
                <View style={styles.replyComposerContent}>
                  <Text style={styles.replyComposerLabel}>{replyingHeader}</Text>
                  <Text style={styles.replyComposerText} numberOfLines={1}>
                    {getPreviewText({
                      text: replyingTo.texto,
                      imageUrl: replyingTo.imagemUrl,
                      audioUrl: replyingTo.audioUrl,
                    })}
                  </Text>
                </View>
                <Pressable style={styles.replyComposerClose} onPress={clearReply}>
                  <MaterialIcons name="close" size={18} color={palette.gray700} />
                </Pressable>
              </View>
            ) : null}

            {showAttachMenu && !isThreadClosed ? (
              <View style={styles.attachMenu}>
                <Pressable
                  style={styles.attachAction}
                  onPress={() => {
                    setShowAttachMenu(false);
                    void sendImage();
                  }}
                  disabled={sending || isRecording || aiLoading}
                >
                  <View style={[styles.attachCircle, styles.attachCircleImage]}>
                    <MaterialIcons name="photo" size={20} color={palette.white} />
                  </View>
                </Pressable>
                <Pressable
                  style={styles.attachAction}
                  onPress={() => {
                    setShowAttachMenu(false);
                    void sendFile();
                  }}
                  disabled={sending || isRecording || aiLoading}
                >
                  <View style={[styles.attachCircle, styles.attachCircleFile]}>
                    <MaterialIcons name="attach-file" size={20} color={palette.white} />
                  </View>
                </Pressable>
                {canUseChatAi ? (
                  <Pressable
                    style={styles.attachAction}
                    onPress={() => {
                      setShowAttachMenu(false);
                      openAiMenu();
                    }}
                    disabled={sending || isRecording || aiLoading}
                  >
                    <View style={[styles.attachCircle, styles.attachCircleAi]}>
                      {aiLoading ? (
                        <ActivityIndicator size="small" color={palette.white} />
                      ) : (
                        <MaterialIcons name="auto-awesome" size={20} color={palette.white} />
                      )}
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.inputRow}>
              <Pressable
                style={[styles.iconButton, showAttachMenu ? styles.iconButtonActive : null]}
                onPress={() => setShowAttachMenu((current) => !current)}
                disabled={sending || isRecording || aiLoading || isThreadClosed}
              >
                <MaterialIcons name={showAttachMenu ? 'close' : 'add'} size={24} color={palette.greenDark} />
              </Pressable>
              <Pressable
                style={[styles.iconButton, isRecording ? styles.recordingButton : null]}
                onPress={handleRecordAudioPress}
                disabled={sending || aiLoading || isThreadClosed}
              >
                <MaterialIcons name={isRecording ? 'stop' : 'keyboard-voice'} size={20} color={isRecording ? palette.white : palette.greenDark} />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Digite sua mensagem"
                style={styles.input}
                editable={!isRecording && !aiLoading && !isThreadClosed}
                placeholderTextColor={palette.gray500}
              />
              <Pressable
                style={[styles.iconButton, styles.sendButton, !canSendText ? styles.sendButtonDisabled : null]}
                onPress={sendText}
                disabled={!canSendText}
              >
                <MaterialIcons name="send" size={20} color={palette.white} />
              </Pressable>
            </View>

            {aiLoading ? (
              <View style={styles.aiHintRow}>
                <ActivityIndicator size="small" color={palette.greenDark} />
                <Text style={styles.aiHintText}>Assistente IA processando...</Text>
              </View>
            ) : null}
            {isRecording ? (
              <View style={styles.recordingHintRow}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingHintText}>Gravando áudio... toque no botão para enviar.</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#D9DED8',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    backgroundColor: palette.white,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerBackButton: {
    paddingRight: spacing.xs,
  },
  headerTitleWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    color: palette.gray900,
    fontSize: 19,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  threadStatusPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  threadStatusPillOpen: {
    backgroundColor: '#DCFCE7',
  },
  threadStatusPillClosed: {
    backgroundColor: '#E5E7EB',
  },
  threadStatusPillText: {
    color: palette.gray900,
    fontSize: 12,
    fontWeight: '800',
  },
  manageThreadButton: {
    minHeight: 36,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.gray300,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  manageThreadButtonDisabled: {
    opacity: 0.6,
  },
  manageThreadButtonText: {
    color: palette.gray900,
    fontSize: 13,
    fontWeight: '700',
  },
  closedThreadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    backgroundColor: '#F3F4F6',
  },
  closedThreadBannerText: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowTheirs: {
    justifyContent: 'flex-start',
  },
  messageAvatarContainer: {
    width: 33,
    height: 33,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  messageAvatar: {
    width: '100%',
    height: '100%',
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  messageBubbleHighlighted: {
    borderWidth: 1,
    borderColor: palette.greenDark,
  },
  mine: {
    marginLeft: 'auto',
    backgroundColor: '#DDEED8',
  },
  theirs: {
    marginRight: 'auto',
    backgroundColor: palette.white,
  },
  author: {
    color: palette.gray700,
    fontWeight: '700',
    fontSize: 14,
  },
  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  replyQuoteMine: {
    borderLeftColor: palette.greenDark,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  replyQuoteTheirs: {
    borderLeftColor: palette.greenDark,
    backgroundColor: '#F3F5F2',
  },
  replyAuthor: {
    color: palette.gray900,
    fontSize: 13,
    fontWeight: '700',
  },
  replyText: {
    color: palette.gray700,
    fontSize: 19,
  },
  messageText: {
    color: palette.gray900,
    fontSize: 15,
  },
  messageImage: {
    width: 230,
    height: 230,
    borderRadius: radii.sm,
  },
  fileBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 220,
  },
  fileBubbleText: {
    color: palette.gray700,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  messageFooterOnlyTime: {
    justifyContent: 'flex-end',
  },
  time: {
    color: palette.gray500,
    fontSize: 13,
  },
  composerContainer: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.gray100,
    backgroundColor: palette.white,
    position: 'relative',
    overflow: 'visible',
  },
  closedAiOnlyWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  closedAiOnlyButton: {
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: palette.greenDark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  closedAiOnlyButtonDisabled: {
    opacity: 0.7,
  },
  closedAiOnlyButtonText: {
    color: palette.white,
    fontSize: 15,
    fontWeight: '800',
  },
  replyComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  replyComposerContent: {
    flex: 1,
    gap: 2,
  },
  replyComposerLabel: {
    color: palette.greenDark,
    fontSize: 13,
    fontWeight: '700',
  },
  replyComposerText: {
    color: palette.gray700,
    fontSize: 14,
  },
  replyComposerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.sm,
    backgroundColor: palette.white,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: {
    borderWidth: 1,
    borderColor: palette.greenDark,
  },
  sendButton: {
    backgroundColor: palette.greenDark,
  },
  recordingButton: {
    backgroundColor: '#DC2626',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  aiHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  aiHintText: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '600',
  },
  recordingHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  recordingHintText: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '600',
  },
  attachMenu: {
    position: 'absolute',
    left: spacing.md,
    bottom: 76,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'transparent',
    zIndex: 30,
  },
  attachAction: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs
  },
  attachCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachCircleImage: {
    backgroundColor: '#22C55E',
  },
  attachCircleFile: {
    backgroundColor: '#3B82F6',
  },
  attachCircleAi: {
    backgroundColor: '#0F766E',
  },
  attachLabel: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  audioBubble: {
    width: 230,
    height: 35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: palette.gray300,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  audioBubbleText: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    width: '90%'
  },
  audioDuration: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    fontSize: 15,
    color: palette.gray900,
  },
});
