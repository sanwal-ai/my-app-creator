package com.myappcreator.client

import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

class MainActivity : AppCompatActivity() {
 private val db by lazy { FirebaseFirestore.getInstance() }
 private val appDocumentId = "1791224204585"

 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(32,48,32,32) }
  val status=TextView(this).apply { text="Loading app from Firebase..."; textSize=18f }
  root.addView(status); setContentView(root)
  if(appDocumentId=="REPLACE_WITH_APP_ID"){ status.text="Android template ready. Next: connect Builder app ID."; return }
  db.collection("apps").document(appDocumentId).get().addOnSuccessListener { app ->
   status.text=app.getString("name") ?: "My App"
   db.collection("apps").document(appDocumentId).collection("sections").orderBy("createdAt",Query.Direction.ASCENDING).get()
    .addOnSuccessListener { snap -> snap.documents.filter { it.getBoolean("enabled") != false }.forEach { s ->
     root.addView(TextView(this).apply { text=s.getString("name") ?: s.getString("type") ?: "Section"; textSize=16f; setPadding(0,24,0,8) })
    }}
  }.addOnFailureListener { status.text="Firebase load failed: ${it.message}" }
 }
}
