import { useMemo } from 'react';
import { palette } from '../constants/theme';

export const useAppTheme = () => {
  const isDark = false;

  const colors = useMemo(() => palette, []);

  return {
    isDark,
    colors,
  };
};
