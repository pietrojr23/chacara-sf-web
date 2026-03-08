import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
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
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types/navigation';
import { useAuth } from '../../contexts/AuthContext';
import {
  getAllUsers,
  markChatMessageAsRead,
  sendChatMessage,
  subscribeGeneralMessages,
  subscribePrivateMessages,
} from '../../services/firestoreService';
import { uploadImageAsync } from '../../services/storageService';
import { ChatMessage } from '../../types/models';
import { palette, radii, spacing } from '../../constants/theme';
import { formatDateBR } from '../../utils/format';
import { getFileExtension, getFileNameFromPath, inferFileKind } from '../../utils/file';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

export const ChatRoomScreen = ({ route }: Props) => {
  const { chatId, title, isPrivate = false } = route.params;
  const { profile } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [userPhotoById, setUserPhotoById] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubscribe = isPrivate
      ? subscribePrivateMessages(chatId, setMessages)
      : subscribeGeneralMessages(setMessages);

    return unsubscribe;
  }, [chatId, isPrivate]);

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

  useEffect(() => {
    if (!profile) {
      return;
    }

    messages.forEach((message) => {
      if (message.enviadoPor === profile.id) {
        return;
      }

      if (message.lidoPor?.includes(profile.id)) {
        return;
      }

      markChatMessageAsRead({
        chatId,
        isPrivate,
        messageId: message.id,
        userId: profile.id,
      }).catch(() => undefined);
    });
  }, [chatId, isPrivate, messages, profile]);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm)), [messages]);

  const getSenderPhotoUrl = useCallback(
    (message: ChatMessage) => {
      if (message.enviadoPor === profile?.id) {
        return profile.photoURL ?? message.enviadoPorFotoURL;
      }

      return userPhotoById[message.enviadoPor] ?? message.enviadoPorFotoURL;
    },
    [profile, userPhotoById],
  );

  const sendText = async () => {
    if (!draft.trim() || !profile) {
      return;
    }

    try {
      setSending(true);
      await sendChatMessage({
        chatId,
        isPrivate,
        text: draft.trim(),
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
      setDraft('');
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  const sendImage = async () => {
    if (!profile) {
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
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  };

  const sendFile = async () => {
    if (!profile) {
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
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{isPrivate ? 'Conversa privada' : 'Grupo geral da chácara'}</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const mine = item.enviadoPor === profile?.id;
          const senderPhotoUrl = getSenderPhotoUrl(item);
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

              <View style={[styles.messageBubble, mine ? styles.mine : styles.theirs]}>
                <Text style={styles.author}>{mine ? 'Você' : item.enviadoPorNome}</Text>
                {item.texto ? <Text style={styles.messageText}>{item.texto}</Text> : null}
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
                <View style={styles.messageFooter}>
                  <Text style={styles.time}>{formatDateBR(item.enviadoEm, 'HH:mm')}</Text>
                  <Text style={styles.seen}>{(item.lidoPor?.length ?? 0) > 1 ? 'Visto' : 'Enviado'}</Text>
                </View>
              </View>

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

      <View style={styles.inputRow}>
        <Pressable style={styles.iconButton} onPress={sendImage}>
          <MaterialIcons name="photo" size={22} color={palette.greenDark} />
        </Pressable>
        <Pressable style={styles.iconButton} onPress={sendFile}>
          <MaterialIcons name="attach-file" size={22} color={palette.greenDark} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Digite sua mensagem"
          style={styles.input}
          placeholderTextColor={palette.gray500}
        />
        <Pressable style={[styles.iconButton, styles.sendButton]} onPress={sendText} disabled={sending}>
          <MaterialIcons name="send" size={20} color={palette.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.sand,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    backgroundColor: palette.white,
  },
  title: {
    color: palette.gray900,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.gray700,
    fontSize: 12,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
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
    width: 28,
    height: 28,
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
    maxWidth: '78%',
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
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
    fontSize: 12,
  },
  messageText: {
    color: palette.gray900,
    fontSize: 14,
  },
  messageImage: {
    width: 180,
    height: 180,
    borderRadius: radii.md,
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
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  time: {
    color: palette.gray500,
    fontSize: 11,
  },
  seen: {
    color: palette.gray500,
    fontSize: 11,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.gray100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: palette.white,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    backgroundColor: palette.greenDark,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.gray900,
  },
});
