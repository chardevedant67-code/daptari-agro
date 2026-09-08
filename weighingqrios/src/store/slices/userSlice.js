import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getBaseUrl, ensureServerConfigReady} from '../../services/serverConfig';

export const loginThunk = createAsyncThunk(
  'user/login',
  async ({email, password}, {rejectWithValue}) => {
    try {
      await ensureServerConfigReady();
      const baseUrl = getBaseUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${baseUrl}/api/user/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, password}),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.success) return rejectWithValue(data.message || 'Login failed');
      await AsyncStorage.setItem('@session_user', JSON.stringify(data.user));
      await AsyncStorage.setItem('@session_token', data.token);
      return {user: data.user, token: data.token};
    } catch (err) {
      const baseUrl = getBaseUrl();
      if (err.name === 'AbortError') {
        return rejectWithValue(`Server timeout (${baseUrl}) — check WiFi and server is running`);
      }
      return rejectWithValue(`Connection failed to ${baseUrl}: ${err.message}`);
    }
  },
);

export const loadSessionThunk = createAsyncThunk(
  'user/loadSession',
  async (_, {rejectWithValue}) => {
    try {
      const userStr = await AsyncStorage.getItem('@session_user');
      const token   = await AsyncStorage.getItem('@session_token');
      if (userStr && token) {
        return {user: JSON.parse(userStr), token};
      }
      return null;
    } catch {
      return rejectWithValue(null);
    }
  },
);

export const logoutThunk = createAsyncThunk('user/logout', async () => {
  try {
    await AsyncStorage.removeItem('@session_user');
    await AsyncStorage.removeItem('@session_token');
  } catch (_) {}
});

export const updateProfileThunk = createAsyncThunk(
  'user/updateProfile',
  async ({name, email, token}, {rejectWithValue}) => {
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}/api/user/me`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({name, email}),
      });
      const data = await res.json();
      if (!data.success) return rejectWithValue(data.message);
      await AsyncStorage.setItem('@session_user', JSON.stringify(data.user));
      return data.user;
    } catch {
      return rejectWithValue('Failed to update profile');
    }
  },
);

const userSlice = createSlice({
  name: 'user',
  initialState: {
    user:    null,
    token:   null,
    loading: false,
    error:   null,
    sessionLoaded: false,
  },
  reducers: {
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginThunk.pending,   (s) => { s.loading = true;  s.error = null; })
      .addCase(loginThunk.fulfilled, (s, a) => {
        s.loading = false;
        s.user    = a.payload.user;
        s.token   = a.payload.token;
      })
      .addCase(loginThunk.rejected,  (s, a) => {
        s.loading = false;
        s.error   = a.payload;
      });

    builder
      .addCase(loadSessionThunk.fulfilled, (s, a) => {
        s.sessionLoaded = true;
        if (a.payload) { s.user = a.payload.user; s.token = a.payload.token; }
      })
      .addCase(loadSessionThunk.rejected, (s) => { s.sessionLoaded = true; });

    builder.addCase(logoutThunk.fulfilled, (s) => {
      s.user = null; s.token = null;
    });

    builder
      .addCase(updateProfileThunk.fulfilled, (s, a) => { s.user = a.payload; })
      .addCase(updateProfileThunk.rejected,  (s, a) => { s.error = a.payload; });
  },
});

export const {clearError} = userSlice.actions;
export default userSlice.reducer;
