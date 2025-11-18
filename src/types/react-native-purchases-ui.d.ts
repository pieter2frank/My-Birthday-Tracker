declare module 'react-native-purchases-ui' {
  import * as React from 'react';
    import type { Offering } from 'react-native-purchases';

  export interface PaywallEvent {
    type?: string;
    [k: string]: any;
  }

  export interface PaywallViewProps {
    offering: Offering | any;
    onEvent?: (ev: PaywallEvent) => void;
    onDismiss?: () => void;
    // extra props die je lib-versie ondersteunt
    [k: string]: any;
  }

  const PaywallView: React.ComponentType<PaywallViewProps>;
  export default PaywallView;
}
