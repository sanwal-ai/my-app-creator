import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB383ITQYkyH8XK5JkuD6JEfdyggsPaMFA",
  authDomain: "myappcreator-2bd13.firebaseapp.com",
  projectId: "myappcreator-2bd13",
  storageBucket: "myappcreator-2bd13.firebasestorage.app",
  messagingSenderId: "98660702874",
  appId: "1:98660702874:web:3826ddb7d100437c42dd23",
  measurementId: "G-SPNJQTZ64H"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

export { app, db };