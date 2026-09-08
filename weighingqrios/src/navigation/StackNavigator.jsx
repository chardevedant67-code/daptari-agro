import React from 'react';
import {NavigationContainer, useNavigation as useNav} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import MainTabsPaper from './MainTabsPaper';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ScannerScreen from '../screens/ScannerScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import WeighingScreen from '../screens/WeighingScreen';
import ResultScreen from '../screens/ResultScreen';
import WeighScanScreen from '../screens/WeighScanScreen';
import SessionStartScreen from '../screens/SessionStartScreen';
import PhotoCaptureScreen from '../screens/PhotoCaptureScreen';
import WeighBeforeScreen from '../screens/WeighBeforeScreen';
import WeighAfterScreen from '../screens/WeighAfterScreen';
import QRBindScreen from '../screens/QRBindScreen';
import PacketViewScreen from '../screens/PacketViewScreen';

export const useNavigation = useNav;

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Splash">
        <Stack.Screen name="Splash"         component={SplashScreen}       options={{headerShown: false}} />
        <Stack.Screen name="Login"          component={LoginScreen}        options={{title: 'Sign In'}} />
        <Stack.Screen name="Register"       component={RegisterScreen}     options={{headerShown: false}} />
        <Stack.Screen name="MainTabs"       component={MainTabsPaper}      options={{headerShown: false}} />
        <Stack.Screen name="Scanner"        component={ScannerScreen}      options={{headerShown: false}} />
        <Stack.Screen name="ProductDetail"  component={ProductDetailScreen} options={{title: 'Product Details'}} />
        <Stack.Screen name="Weighing"       component={WeighingScreen}     options={{title: 'Weighing Process'}} />
        <Stack.Screen name="Result"         component={ResultScreen}       options={{title: 'Measurement Result'}} />
        <Stack.Screen name="WeighScan"      component={WeighScanScreen}    options={{headerShown: false}} />
        <Stack.Screen name="SessionStart"   component={SessionStartScreen} options={{headerShown: false}} />
        <Stack.Screen name="PhotoCapture"   component={PhotoCaptureScreen} options={{headerShown: false}} />
        <Stack.Screen name="WeighBefore"    component={WeighBeforeScreen}  options={{headerShown: false}} />
        <Stack.Screen name="WeighAfter"     component={WeighAfterScreen}   options={{headerShown: false}} />
        <Stack.Screen name="QRBind"         component={QRBindScreen}       options={{headerShown: false}} />
        <Stack.Screen name="PacketView"     component={PacketViewScreen}   options={{headerShown: false}} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
