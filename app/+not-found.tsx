import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View className="flex-1 items-center justify-center bg-void px-10">
        <Text className="text-[17px] font-medium text-ink">This screen does not exist.</Text>
        <Link href="/(tabs)" className="mt-4">
          <Text className="text-[14px] text-sage">Back to Today</Text>
        </Link>
      </View>
    </>
  );
}
