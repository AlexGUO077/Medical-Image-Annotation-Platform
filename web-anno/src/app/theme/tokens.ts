import { theme, type ThemeConfig } from 'antd';

const sharedTokens: ThemeConfig['token'] = {
  colorPrimary: '#1677FF',
  colorInfo: '#1677FF',
  colorSuccess: '#52C41A',
  colorWarning: '#FA8C16',
  colorError: '#F5222D',
  fontSize: 14,
  borderRadius: 6,
};

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: sharedTokens,
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedTokens,
    colorBgBase: '#101418',
    colorTextBase: '#F5F7FA',
    colorBorder: '#30363D',
  },
};
