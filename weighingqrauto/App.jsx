import {useEffect} from 'react';
import {StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {Provider as PaperProvider} from 'react-native-paper';
import {Provider as ReduxProvider, useDispatch} from 'react-redux';
import store from './src/store';
import StackNavigator from './src/navigation/StackNavigator';
import {loadNotifPreferenceThunk} from './src/store/slices/notificationSlice';
import {initServerConfig} from './src/services/serverConfig';

function AppInner() {
  const isDarkMode = useColorScheme() === 'dark';
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(loadNotifPreferenceThunk());
    initServerConfig();          // auto-detect & load saved server URL
  }, [dispatch]);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <PaperProvider>
        <View style={styles.container}>
          <StackNavigator />
        </View>
      </PaperProvider>
    </>
  );
}

function App() {
  return (
    <ReduxProvider store={store}>
      <AppInner />
    </ReduxProvider>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
});

export default App;
