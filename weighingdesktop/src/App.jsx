import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import LoginScreen from './screens/LoginScreen';
import DataManagerScreen from './screens/DataManagerScreen';

const desktop = window.desktop;

// The whole app is these two screens: signed out -> LoginScreen, signed in
// -> DataManagerScreen. There is no router and nothing in between.
export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    // Session changes pushed from the main process: an expired or revoked
    // session returns the user to the login screen wherever they are.
    const off = desktop.on('session', setSession);
    (async () => {
      try {
        setInfo(await desktop.call('app.info'));
        setSession(await desktop.call('auth.restore'));
      } catch (_) {
        setSession(null);
      } finally {
        setReady(true);
      }
    })();
    return off;
  }, []);

  if (!ready || !info) {
    return (
      <Box sx={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return session
    ? <DataManagerScreen session={session} info={info} />
    : <LoginScreen onSignedIn={setSession} serverUrl={info.apiUrl} version={info.version} />;
}
