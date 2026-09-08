import {configureStore} from '@reduxjs/toolkit';
import userReducer from './slices/userSlice';
import notificationReducer from './slices/notificationSlice';

const store = configureStore({
  reducer: {
    user: userReducer,
    notifications: notificationReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({serializableCheck: false}),
});

export default store;
