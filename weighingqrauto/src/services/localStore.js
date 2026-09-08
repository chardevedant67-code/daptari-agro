import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory cache
const _records = [];
let _user = null;
let _token = null;

export const addRecord = (record) => {
  _records.unshift({
    _id: 'local_' + Date.now(),
    status: record.status,
    actualWeight: record.actualWeight,
    nominalWeight: record.nominalWeight,
    unit: 'kg',
    product: record.product,
    machine: record.machine,
    createdAt: new Date().toISOString(),
  });
};

export const getRecords = () => [..._records];

// Save session to memory + AsyncStorage
export const setSession = async (user, token) => {
  _user = user;
  _token = token;
  await AsyncStorage.setItem('@session_user', JSON.stringify(user));
  await AsyncStorage.setItem('@session_token', token || '');
};

// Load session from AsyncStorage into memory (call on app start)
export const loadSession = async () => {
  try {
    const userStr = await AsyncStorage.getItem('@session_user');
    const token = await AsyncStorage.getItem('@session_token');
    if (userStr && token) {
      _user = JSON.parse(userStr);
      _token = token;
      return {user: _user, token: _token};
    }
  } catch (_) {}
  return null;
};

export const getSession = () => ({user: _user, token: _token});

export const clearSession = async () => {
  _user = null;
  _token = null;
  await AsyncStorage.removeItem('@session_user');
  await AsyncStorage.removeItem('@session_token');
};
