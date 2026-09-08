import {createSlice} from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_NOTIFICATIONS = 50;

const notificationSlice = createSlice({
  name: 'notifications',
  initialState: {
    list: [],            // [{id, type, title, body, time, read}]
    enabled: true,       // user preference
  },
  reducers: {
    addNotification: (state, action) => {
      if (!state.enabled) return;
      const item = {
        id: Date.now() + Math.random(),
        read: false,
        time: new Date().toISOString(),
        ...action.payload,
      };
      state.list.unshift(item);
      if (state.list.length > MAX_NOTIFICATIONS) {
        state.list = state.list.slice(0, MAX_NOTIFICATIONS);
      }
    },
    markAllRead: (state) => {
      state.list.forEach(n => { n.read = true; });
    },
    clearNotifications: (state) => {
      state.list = [];
    },
    setNotificationsEnabled: (state, action) => {
      state.enabled = action.payload;
    },
  },
});

export const {
  addNotification,
  markAllRead,
  clearNotifications,
  setNotificationsEnabled,
} = notificationSlice.actions;

// Thunk: toggle enabled + persist
export const toggleNotificationsThunk = (value) => async (dispatch) => {
  dispatch(setNotificationsEnabled(value));
  try {
    await AsyncStorage.setItem('@notif_enabled', value ? '1' : '0');
  } catch (_) {}
};

// Thunk: load preference on startup
export const loadNotifPreferenceThunk = () => async (dispatch) => {
  try {
    const val = await AsyncStorage.getItem('@notif_enabled');
    if (val === '0') dispatch(setNotificationsEnabled(false));
  } catch (_) {}
};

export default notificationSlice.reducer;
