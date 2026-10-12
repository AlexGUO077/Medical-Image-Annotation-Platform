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

// OHIF ui-next palette: backgrounds, action blue, highlight cyan and secondary text.
export const viewerPalette = {
  bg: '#000000',
  panel: '#090C29',
  header: '#041C4A',
  raised: '#041C4A',
  hover: '#050615',
  selected: '#1B325F',
  border: '#252B65',
  controlBorder: '#526A94',
  text: '#FFFFFF',
  muted: '#7BB2CE',
  neutral: '#B3CCE9',
  action: '#348CFD',
  accent: '#5ACCE6',
  disabled: '#667184',
};

export const viewerCssVariables = Object.fromEntries(
  Object.entries(viewerPalette).map(([name, value]) => [`--viewer-${name}`, value]),
);

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedTokens,
    colorPrimary: viewerPalette.action,
    colorInfo: viewerPalette.action,
    colorBgBase: viewerPalette.bg,
    colorBgContainer: viewerPalette.panel,
    colorBgElevated: viewerPalette.raised,
    colorTextBase: viewerPalette.text,
    colorText: viewerPalette.text,
    colorTextSecondary: viewerPalette.neutral,
    colorBorder: viewerPalette.controlBorder,
    controlHeight: 36,
    colorPrimaryHover: viewerPalette.accent,
    colorLink: viewerPalette.action,
    colorLinkHover: viewerPalette.accent,
    colorTextDisabled: viewerPalette.disabled,
    colorBgContainerDisabled: 'transparent',
    colorFillSecondary: viewerPalette.hover,
    controlItemBgHover: viewerPalette.hover,
    controlItemBgActive: viewerPalette.selected,
  },
  components: {
    Button: {
      defaultColor: viewerPalette.action, defaultBg: 'transparent', defaultBorderColor: 'transparent',
      defaultHoverBg: viewerPalette.hover, defaultHoverColor: viewerPalette.action, defaultHoverBorderColor: 'transparent',
      defaultActiveBg: viewerPalette.hover, defaultActiveColor: viewerPalette.accent, defaultActiveBorderColor: 'transparent',
      textTextColor: viewerPalette.action, textTextHoverColor: viewerPalette.action, textTextActiveColor: viewerPalette.accent,
      textHoverBg: viewerPalette.hover, borderColorDisabled: 'transparent',
      defaultShadow: 'none', primaryShadow: 'none',
    },
    Menu: {
      darkItemBg: viewerPalette.panel, darkItemColor: viewerPalette.action,
      darkItemHoverBg: viewerPalette.hover, darkItemHoverColor: viewerPalette.action,
      darkItemSelectedBg: viewerPalette.selected, darkItemSelectedColor: viewerPalette.action,
    },
    Tabs: { itemColor: viewerPalette.muted, itemHoverColor: viewerPalette.action, itemSelectedColor: viewerPalette.action, inkBarColor: viewerPalette.action },
  },
};

// UI requirements §6.3: identity colors, independent of clinical or workflow status.
export const annotationColors = ['#22D3EE', '#FACC15', '#FB7185', '#A78BFA', '#A3E635', '#FB923C', '#60A5FA', '#F472B6', '#2DD4BF', '#D9F99D', '#C084FC', '#FDBA74'];
