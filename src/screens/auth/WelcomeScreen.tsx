import { useEffect, useRef } from 'react';
import { Animated, Easing, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { AppButton } from '../../components/AppButton';
import { palette, spacing } from '../../constants/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export const WelcomeScreen = ({ navigation }: Props) => {
  const titleFloat = useRef(new Animated.Value(0)).current;
  const buttonFloat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const titleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(titleFloat, {
          toValue: -10,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(titleFloat, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const buttonAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(buttonFloat, {
          toValue: -8,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(buttonFloat, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    titleAnimation.start();
    buttonAnimation.start();

    return () => {
      titleAnimation.stop();
      buttonAnimation.stop();
    };
  }, [buttonFloat, titleFloat]);

  return (
    <ImageBackground source={require('../../../assets/chacara-splash.png')} style={styles.background} imageStyle={styles.image}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Animated.Text style={[styles.title, { transform: [{ translateY: titleFloat }] }]}>
            Chácara São Francisco
          </Animated.Text>
          <Text style={styles.subtitle}>Gestão da propriedade na palma da mão</Text>
        </View>

        <View style={styles.actions}>
          <Animated.View style={{ transform: [{ translateY: buttonFloat }] }}>
            <AppButton label="Entrar" onPress={() => navigation.navigate('Login')} />
          </Animated.View>
        </View>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#0F2530',
  },
  image: {
    opacity: 1,
    resizeMode: 'cover',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.xl,
    backgroundColor: 'rgba(7, 19, 31, 0.45)',
  },
  header: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    color: '#F6FBFF',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5,
  },
  subtitle: {
    color: '#E2EEF9',
    fontSize: 16,
    lineHeight: 22,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actions: {
    gap: spacing.md,
  },
});
