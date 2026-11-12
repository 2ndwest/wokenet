// Loaded only by run.mjs's development HTML transform. Production uses src/main.tsx.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../../src/index.css';
import App from '../../src/App';
import { DisplayProvider,useDisplaySettings } from '../../src/utils/useDisplaySettings';
import './mirror.css';
function Mirror(){
 const {resolved,accent}=useDisplaySettings();
 return <Theme appearance={resolved} accentColor={accent} grayColor="slate" radius="small" scaling="95%">
  <div className="mirror-notice" role="note"><span>LOCAL MIRROR · Pi footage · preview accounts/data</span><a href="https://wokenet.putz.sh" target="_blank" rel="noreferrer">Live site ↗</a></div>
  <div className="mirror-app"><BrowserRouter><App/></BrowserRouter></div>
 </Theme>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><DisplayProvider><Mirror/></DisplayProvider></StrictMode>);
