import { Alert, AlertButton, Platform } from 'react-native';

type AlertOptions = Record<string, unknown>;

const formatMessage = (title?: string, message?: string) => {
  const parts = [title, message].filter(
    (part): part is string => Boolean(part && String(part).trim()),
  );
  return parts.join('\n\n');
};

const installWebAlertShim = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  const shim = (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
    _options?: AlertOptions,
  ) => {
    const text = formatMessage(title, message);
    const list = Array.isArray(buttons) ? buttons : [];

    if (list.length > 1) {
      const cancelButton = list.find((button) => button.style === 'cancel');
      const confirmButton =
        list.find((button) => button.style !== 'cancel') ?? list[list.length - 1];
      const accepted = window.confirm(text);

      if (accepted) {
        confirmButton?.onPress?.();
      } else {
        cancelButton?.onPress?.();
      }

      return;
    }

    window.alert(text);
    list[0]?.onPress?.();
  };

  (Alert as unknown as { alert: typeof shim }).alert = shim;
};

installWebAlertShim();

export {};
