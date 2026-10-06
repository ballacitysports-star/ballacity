export const ONESIGNAL_APP_ID = "c6024ea7-b1a2-4f64-b43a-783971d802f9";
export const ONESIGNAL_API = "https://api.onesignal.com/notifications";

export type PushInput = {
  userId: string;
  title: string;
  body?: string | null;
  url?: string | null;
};
