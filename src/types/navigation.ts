export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  TicketForm: undefined;
  ChatRoom: { chatId: string; title: string; isPrivate?: boolean };
  MoreMenu: undefined;
  HouseProfile: undefined;
  Settings: undefined;
  EmergencyContacts: undefined;
  Notices: undefined;
};

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  PhoneLogin: undefined;
  ForgotPassword: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Gate: undefined;
  Cameras: undefined;
  Finance: undefined;
  Tickets: undefined;
  Chat: undefined;
};
