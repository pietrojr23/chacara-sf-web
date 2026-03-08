import { DefaultTheme, DarkTheme, Theme } from '@react-navigation/native';

export const palette = {
  greenDark: '#2D5A27',
  greenPrimary: '#3F7D32',
  greenLight: '#7CB342',
  sand: '#F5F0E8',
  white: '#FFFFFF',
  gold: '#D4AF37',
  danger: '#C62828',
  warning: '#F9A825',
  info: '#1565C0',
  gray900: '#1B1D1B',
  gray700: '#4D4F4D',
  gray500: '#8C8E8C',
  gray300: '#C8CBC8',
  gray100: '#EFF2EF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const appTheme = {
  colors: palette,
  spacing,
  radii,
};

export const navLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.greenPrimary,
    background: palette.sand,
    card: palette.white,
    text: palette.gray900,
    border: palette.gray300,
    notification: palette.warning,
  },
};

export const navDarkTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.greenLight,
    background: '#121612',
    card: '#1E241D',
    text: '#F4F7F4',
    border: '#2F362E',
    notification: palette.warning,
  },
};
