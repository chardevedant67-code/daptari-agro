import React, {useEffect, useMemo, useState} from 'react';
import {BottomNavigation} from 'react-native-paper';
import DashboardScreen from '../screens/DashboardScreen';
import HistoryScreen from '../screens/HistoryScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import {useRoute} from '@react-navigation/native';

const HomeRoute      = () => <DashboardScreen />;
const HistoryRoute   = () => <HistoryScreen />;
const AnalyticsRoute = () => <AnalyticsScreen />;
const SettingsRoute  = () => <SettingsScreen />;

const renderScene = BottomNavigation.SceneMap({
  home:      HomeRoute,
  history:   HistoryRoute,
  analytics: AnalyticsRoute,
  settings:  SettingsRoute,
});

export default function MainTabsPaper() {
  const route = useRoute();
  const initialIndex = useMemo(() => {
    const tab = route.params?.initialTab;
    if (tab === 'history')   return 1;
    if (tab === 'analytics') return 2;
    if (tab === 'settings')  return 3;
    return 0;
  }, [route.params]);

  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    const tab = route.params?.initialTab;
    if (tab === 'history')        setIndex(1);
    else if (tab === 'analytics') setIndex(2);
    else if (tab === 'settings')  setIndex(3);
    else if (tab === 'home')      setIndex(0);
  }, [route.params?.initialTab]);

  const [routes] = useState([
    {key: 'home',      title: 'Home',      focusedIcon: 'home'},
    {key: 'history',   title: 'History',   focusedIcon: 'history'},
    {key: 'analytics', title: 'Analytics', focusedIcon: 'chart-line'},
    {key: 'settings',  title: 'Settings',  focusedIcon: 'cog'},
  ]);

  return (
    <BottomNavigation
      navigationState={{index, routes}}
      onIndexChange={setIndex}
      renderScene={renderScene}
      shifting={false}
      sceneAnimationEnabled
    />
  );
}
