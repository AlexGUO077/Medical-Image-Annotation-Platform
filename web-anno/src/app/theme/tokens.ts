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
    colorPrimary: '#58CDE0',
    colorInfo: '#58CDE0',
    colorBgBase: '#050911',
    colorBgContainer: '#0D172B',
    colorBgElevated: '#142440',
    colorTextBase: '#EDF4FF',
    colorText: '#E4ECF7',
    colorTextSecondary: '#A4BAD4',
    colorBorder: '#415877',
    controlHeight: 36,
  },
};

// UI requirements §6.3: identity colors, independent of clinical or workflow status.
export const annotationColors = ['#22D3EE', '#FACC15', '#FB7185', '#A78BFA', '#A3E635', '#FB923C', '#60A5FA', '#F472B6', '#2DD4BF', '#D9F99D', '#C084FC', '#FDBA74'];
