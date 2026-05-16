import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBXmsLH5A8xecbIV6U7pSg302CJ_P4Dacc",
  authDomain: "initia-creator.firebaseapp.com",
  projectId: "initia-creator",
  storageBucket: "initia-creator.firebasestorage.app",
  messagingSenderId: "25296628139",
  appId: "1:25296628139:web:2ded92a691286f59878aee"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);