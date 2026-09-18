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

export const darkPalette = {
  greenDark: '#6FAE66',
  greenPrimary: '#8BC981',
  greenLight: '#A9DD9F',
  sand: '#121612',
  white: '#1E241D',
  gold: '#D4AF37',
  danger: '#EF5350',
  warning: '#F9A825',
  info: '#64B5F6',
  gray900: '#F4F7F4',
  gray700: '#C7D0C6',
  gray500: '#9AA39A',
  gray300: '#4A5648',
  gray100: '#2A3229',
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

export const typography = {
  size: {
    caption: 12,
    body: 15,
    bodyLg: 16,
    subtitle: 20,
    title: 30,
    hero: 38,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    heavy: '800' as const,
  },
};

export const appTheme = {
  colors: palette,
  spacing,
  radii,
  typography,
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
    primary: darkPalette.greenLight,
    background: darkPalette.sand,
    card: darkPalette.white,
    text: darkPalette.gray900,
    border: darkPalette.gray300,
    notification: palette.warning,
  },
};
