package expo.modules.timev3native

import android.Manifest
import android.content.ContentValues
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.MessageDigest

class CorrespondenceCursor : Record {
  @Field var contactsUpdatedAtMs: Double = 0.0
  @Field var contactsId: Double = 0.0
  @Field var callsAtMs: Double = 0.0
  @Field var callsId: Double = 0.0
  @Field var smsAtMs: Double = 0.0
  @Field var smsId: Double = 0.0
  @Field var mmsAtMs: Double = 0.0
  @Field var mmsId: Double = 0.0
}

class PhoneContactMethodInput : Record {
  @Field var kind: String = "other"
  @Field var label: String? = null
  @Field var value: String = ""
  @Field var isPrimary: Boolean = false
}

class PhoneContactInput : Record {
  @Field var displayName: String = ""
  @Field var givenName: String? = null
  @Field var familyName: String? = null
  @Field var organizationName: String? = null
  @Field var birthDate: String? = null
  @Field var notes: String? = null
  @Field var methods: List<PhoneContactMethodInput> = emptyList()
}

private data class CursorPoint(var timestamp: Long, var id: Long)

private data class ReadResult(
  val records: List<Map<String, Any?>>,
  val point: CursorPoint,
  val hasMore: Boolean,
)

class TimeV3NativeModule : Module() {
  private val syncPermissions = arrayOf(
    Manifest.permission.READ_CONTACTS,
    Manifest.permission.READ_CALL_LOG,
    Manifest.permission.READ_SMS,
  )

  override fun definition() = ModuleDefinition {
    Name("TimeV3Native")

    Constant("nativeShellVersion") { 5 }
    Constant("nativeCapabilities") {
      listOf(
        "compose_text_v1",
        "contacts_read_v1",
        "contact_change_time_v1",
        "contact_insert_intent_v1",
        "contact_open_v1",
        "contact_permission_v1",
        "contact_source_identity_v1",
        "call_log_read_v1",
        "sms_mms_read_v1",
        "correspondence_remaining_count_v1",
      )
    }

    AsyncFunction("composeText") { recipient: String, body: String ->
      val context = requireContext()
      val destination = if (recipient.isBlank()) "smsto:" else "smsto:${Uri.encode(recipient)}"
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse(destination)).apply {
        putExtra("sms_body", body)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException("No messaging app can handle this draft")
      }
      context.startActivity(intent)
    }

    AsyncFunction("getContactDeviceId") {
      deviceId(requireContext())
    }

    AsyncFunction("savePhoneContact") { contact: PhoneContactInput ->
      val context = requireContext()
      val data = phoneContactData(contact)
      val intent = Intent(Intent.ACTION_INSERT).apply {
        type = ContactsContract.Contacts.CONTENT_TYPE
        putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, data)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException("No contacts app can create this contact")
      }
      context.startActivity(intent)
    }

    AsyncFunction("openPhoneContact") { externalIdHash: String ->
      val context = requireContext()
      if (!granted(context, Manifest.permission.READ_CONTACTS)) {
        throw IllegalStateException("Contacts permission is required to open this phone contact")
      }
      if (!externalIdHash.matches(Regex("^[0-9a-f]{64}$"))) {
        throw IllegalArgumentException("The phone contact identity is invalid")
      }
      val contactUri = phoneContactUri(context, externalIdHash)
        ?: throw IllegalStateException("This linked contact is no longer present on the phone")
      val intent = Intent(Intent.ACTION_VIEW, contactUri).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException("No contacts app can open this contact")
      }
      context.startActivity(intent)
    }

    AsyncFunction("requestContactPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.READ_CONTACTS,
      )
    }

    AsyncFunction("getCorrespondencePermissions") {
      permissionMap(requireContext())
    }

    AsyncFunction("requestCorrespondencePermissions") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        *syncPermissions,
      )
    }

    AsyncFunction("readCorrespondenceBatch") Coroutine { cursor: CorrespondenceCursor, requestedLimit: Int ->
      withContext(Dispatchers.IO) {
        readBatch(cursor, requestedLimit.coerceIn(1, 250))
      }
    }

    AsyncFunction("countCorrespondenceRemaining") Coroutine { cursor: CorrespondenceCursor ->
      withContext(Dispatchers.IO) {
        countRemaining(cursor)
      }
    }
  }

  private fun requireContext(): Context = appContext.reactContext
    ?: throw IllegalStateException("Android context is unavailable")

  private fun granted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private fun permissionMap(context: Context) = mapOf(
    "contacts" to granted(context, Manifest.permission.READ_CONTACTS),
    "calls" to granted(context, Manifest.permission.READ_CALL_LOG),
    "messages" to granted(context, Manifest.permission.READ_SMS),
  )

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

  private fun deviceId(context: Context): String {
    val source = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
      ?: "unknown-android-device"
    return sha256(source).take(32)
  }

  private fun phoneContactData(contact: PhoneContactInput): ArrayList<ContentValues> {
    if (contact.displayName.isBlank()) throw IllegalArgumentException("Contact name is required")
    val data = arrayListOf<ContentValues>()
    data += ContentValues().apply {
      put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
      put(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, contact.displayName.trim())
      contact.givenName?.trim()?.takeIf { it.isNotEmpty() }?.let {
        put(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME, it)
      }
      contact.familyName?.trim()?.takeIf { it.isNotEmpty() }?.let {
        put(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME, it)
      }
    }
    contact.organizationName?.trim()?.takeIf { it.isNotEmpty() }?.let { organization ->
      data += ContentValues().apply {
        put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE)
        put(ContactsContract.CommonDataKinds.Organization.COMPANY, organization)
      }
    }
    val noteLines = mutableListOf<String>()
    contact.notes?.trim()?.takeIf { it.isNotEmpty() }?.let(noteLines::add)
    for (method in contact.methods.filter { it.value.isNotBlank() }) {
      val label = method.label?.trim()?.takeIf { it.isNotEmpty() }
      val value = method.value.trim()
      when (method.kind) {
        "phone" -> data += ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Phone.NUMBER, value)
          put(ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_CUSTOM)
          put(ContactsContract.CommonDataKinds.Phone.LABEL, label ?: "Phone")
          put(ContactsContract.CommonDataKinds.Phone.IS_PRIMARY, if (method.isPrimary) 1 else 0)
        }
        "email" -> data += ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Email.ADDRESS, value)
          put(ContactsContract.CommonDataKinds.Email.TYPE, ContactsContract.CommonDataKinds.Email.TYPE_CUSTOM)
          put(ContactsContract.CommonDataKinds.Email.LABEL, label ?: "Email")
          put(ContactsContract.CommonDataKinds.Email.IS_PRIMARY, if (method.isPrimary) 1 else 0)
        }
        "postal_address" -> data += ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.StructuredPostal.FORMATTED_ADDRESS, value)
          put(ContactsContract.CommonDataKinds.StructuredPostal.TYPE, ContactsContract.CommonDataKinds.StructuredPostal.TYPE_CUSTOM)
          put(ContactsContract.CommonDataKinds.StructuredPostal.LABEL, label ?: "Address")
        }
        "url" -> data += ContentValues().apply {
          put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE)
          put(ContactsContract.CommonDataKinds.Website.URL, value)
          put(ContactsContract.CommonDataKinds.Website.TYPE, ContactsContract.CommonDataKinds.Website.TYPE_CUSTOM)
          put(ContactsContract.CommonDataKinds.Website.LABEL, label ?: "Website")
        }
        else -> noteLines += "${label ?: method.kind}: $value"
      }
    }
    contact.birthDate?.trim()?.takeIf { it.isNotEmpty() }?.let { birthDate ->
      data += ContentValues().apply {
        put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE)
        put(ContactsContract.CommonDataKinds.Event.START_DATE, birthDate)
        put(ContactsContract.CommonDataKinds.Event.TYPE, ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY)
      }
    }
    if (noteLines.isNotEmpty()) {
      data += ContentValues().apply {
        put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE)
        put(ContactsContract.CommonDataKinds.Note.NOTE, noteLines.joinToString("\n"))
      }
    }
    return data
  }

  private fun phoneContactUri(context: Context, externalIdHash: String): Uri? {
    val projection = arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.LOOKUP_KEY)
    context.contentResolver.query(
      ContactsContract.Contacts.CONTENT_URI,
      projection,
      null,
      null,
      null,
    )?.use { result ->
      while (result.moveToNext()) {
        val lookupKey = result.string(ContactsContract.Contacts.LOOKUP_KEY) ?: continue
        if (sha256(lookupKey) != externalIdHash) continue
        return ContactsContract.Contacts.getLookupUri(
          result.long(ContactsContract.Contacts._ID),
          lookupKey,
        )
      }
    }
    return null
  }

  private fun countRows(
    context: Context,
    uri: Uri,
    idColumn: String,
    selection: String,
    selectionArgs: Array<String>,
  ): Int = context.contentResolver.query(
    uri,
    arrayOf(idColumn),
    selection,
    selectionArgs,
    null,
  )?.use { result -> result.count } ?: 0

  private fun countRemaining(cursor: CorrespondenceCursor): Map<String, Int> {
    val context = requireContext()
    val permissions = permissionMap(context)
    val contactsSelection = "(${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} > ? OR " +
      "(${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} = ? AND ${ContactsContract.Contacts._ID} > ?))"
    val callsSelection = "(${CallLog.Calls.DATE} > ? OR " +
      "(${CallLog.Calls.DATE} = ? AND ${CallLog.Calls._ID} > ?))"
    val smsSelection = "((${Telephony.Sms.DATE} > ? OR " +
      "(${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} > ?))) AND " +
      "${Telephony.Sms.TYPE} != ?"
    val mmsSelection = "((${Telephony.Mms.DATE} > ? OR " +
      "(${Telephony.Mms.DATE} = ? AND ${Telephony.Mms._ID} > ?))) AND " +
      "${Telephony.Mms.MESSAGE_BOX} != ?"
    return mapOf(
      "contacts" to if (permissions["contacts"] == true) countRows(
        context,
        ContactsContract.Contacts.CONTENT_URI,
        ContactsContract.Contacts._ID,
        contactsSelection,
        arrayOf(
          cursor.contactsUpdatedAtMs.toLong().toString(),
          cursor.contactsUpdatedAtMs.toLong().toString(),
          cursor.contactsId.toLong().toString(),
        ),
      ) else 0,
      "calls" to if (permissions["calls"] == true) countRows(
        context,
        CallLog.Calls.CONTENT_URI,
        CallLog.Calls._ID,
        callsSelection,
        arrayOf(
          cursor.callsAtMs.toLong().toString(),
          cursor.callsAtMs.toLong().toString(),
          cursor.callsId.toLong().toString(),
        ),
      ) else 0,
      "sms" to if (permissions["messages"] == true) countRows(
        context,
        Telephony.Sms.CONTENT_URI,
        Telephony.Sms._ID,
        smsSelection,
        arrayOf(
          cursor.smsAtMs.toLong().toString(),
          cursor.smsAtMs.toLong().toString(),
          cursor.smsId.toLong().toString(),
          Telephony.Sms.MESSAGE_TYPE_DRAFT.toString(),
        ),
      ) else 0,
      "mms" to if (permissions["messages"] == true) countRows(
        context,
        Telephony.Mms.CONTENT_URI,
        Telephony.Mms._ID,
        mmsSelection,
        arrayOf(
          (cursor.mmsAtMs.toLong() / 1000).toString(),
          (cursor.mmsAtMs.toLong() / 1000).toString(),
          cursor.mmsId.toLong().toString(),
          "3",
        ),
      ) else 0,
    )
  }

  private fun readBatch(cursor: CorrespondenceCursor, limit: Int): Map<String, Any?> {
    val context = requireContext()
    val permissions = permissionMap(context)
    val contacts = if (permissions["contacts"] == true) {
      readContacts(context, CursorPoint(cursor.contactsUpdatedAtMs.toLong(), cursor.contactsId.toLong()), limit)
    } else ReadResult(emptyList(), CursorPoint(cursor.contactsUpdatedAtMs.toLong(), cursor.contactsId.toLong()), false)
    val calls = if (permissions["calls"] == true) {
      readCalls(context, CursorPoint(cursor.callsAtMs.toLong(), cursor.callsId.toLong()), limit)
    } else ReadResult(emptyList(), CursorPoint(cursor.callsAtMs.toLong(), cursor.callsId.toLong()), false)
    val sms = if (permissions["messages"] == true) {
      readSms(context, CursorPoint(cursor.smsAtMs.toLong(), cursor.smsId.toLong()), limit)
    } else ReadResult(emptyList(), CursorPoint(cursor.smsAtMs.toLong(), cursor.smsId.toLong()), false)
    val mms = if (permissions["messages"] == true) {
      readMms(context, CursorPoint(cursor.mmsAtMs.toLong(), cursor.mmsId.toLong()), limit)
    } else ReadResult(emptyList(), CursorPoint(cursor.mmsAtMs.toLong(), cursor.mmsId.toLong()), false)

    return mapOf(
      "deviceId" to deviceId(context),
      "permissions" to permissions,
      "contacts" to contacts.records,
      "correspondence" to calls.records + sms.records + mms.records,
      "nextCursor" to mapOf(
        "contactsUpdatedAtMs" to contacts.point.timestamp.toDouble(),
        "contactsId" to contacts.point.id.toDouble(),
        "callsAtMs" to calls.point.timestamp.toDouble(),
        "callsId" to calls.point.id.toDouble(),
        "smsAtMs" to sms.point.timestamp.toDouble(),
        "smsId" to sms.point.id.toDouble(),
        "mmsAtMs" to mms.point.timestamp.toDouble(),
        "mmsId" to mms.point.id.toDouble(),
      ),
      "hasMore" to mapOf(
        "contacts" to contacts.hasMore,
        "calls" to calls.hasMore,
        "sms" to sms.hasMore,
        "mms" to mms.hasMore,
      ),
    )
  }

  private fun Cursor.long(column: String): Long = getLong(getColumnIndexOrThrow(column))
  private fun Cursor.string(column: String): String? {
    val index = getColumnIndex(column)
    return if (index < 0 || isNull(index)) null else getString(index)
  }

  private fun readContacts(context: Context, start: CursorPoint, limit: Int): ReadResult {
    val projection = arrayOf(
      ContactsContract.Contacts._ID,
      ContactsContract.Contacts.LOOKUP_KEY,
      ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
      ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP,
    )
    val selection = "(${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} > ? OR " +
      "(${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} = ? AND ${ContactsContract.Contacts._ID} > ?))"
    val rows = mutableListOf<Map<String, Any?>>()
    val point = start.copy()
    var hasMore = false
    context.contentResolver.query(
      ContactsContract.Contacts.CONTENT_URI,
      projection,
      selection,
      arrayOf(start.timestamp.toString(), start.timestamp.toString(), start.id.toString()),
      "${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} ASC, ${ContactsContract.Contacts._ID} ASC",
    )?.use { result ->
      var read = 0
      while (result.moveToNext()) {
        if (read >= limit) {
          hasMore = true
          break
        }
        val contactId = result.long(ContactsContract.Contacts._ID)
        val updatedAt = result.long(ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP)
        point.timestamp = updatedAt
        point.id = contactId
        read += 1
        val displayName = result.string(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY)
          ?.trim().orEmpty().ifBlank { "Unnamed contact" }
        val details = readContactDetails(context, contactId)
        rows += mapOf(
          "externalId" to (result.string(ContactsContract.Contacts.LOOKUP_KEY) ?: contactId.toString()),
          "updatedAtMs" to updatedAt.toDouble(),
          "displayName" to displayName,
          "givenName" to details["givenName"],
          "familyName" to details["familyName"],
          "organizationName" to details["organizationName"],
          "methods" to details["methods"],
        )
      }
    }
    return ReadResult(rows, point, hasMore)
  }

  private fun readContactDetails(context: Context, contactId: Long): Map<String, Any?> {
    val projection = arrayOf(
      ContactsContract.Data.MIMETYPE,
      ContactsContract.Data.DATA1,
      ContactsContract.Data.DATA2,
      ContactsContract.Data.DATA3,
      ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER,
      ContactsContract.CommonDataKinds.Phone.IS_PRIMARY,
    )
    var givenName: String? = null
    var familyName: String? = null
    var organizationName: String? = null
    val methods = mutableListOf<Map<String, Any?>>()
    context.contentResolver.query(
      ContactsContract.Data.CONTENT_URI,
      projection,
      "${ContactsContract.Data.CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} IN (?, ?, ?, ?)",
      arrayOf(
        contactId.toString(),
        ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
        ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
        ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
        ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE,
      ),
      null,
    )?.use { result ->
      while (result.moveToNext()) {
        when (result.string(ContactsContract.Data.MIMETYPE)) {
          ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE -> {
            givenName = result.string(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME)
            familyName = result.string(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME)
          }
          ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE -> {
            organizationName = result.string(ContactsContract.CommonDataKinds.Organization.COMPANY)
          }
          ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> {
            val value = result.string(ContactsContract.CommonDataKinds.Phone.NUMBER) ?: continue
            val type = result.long(ContactsContract.CommonDataKinds.Phone.TYPE).toInt()
            val label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(
              context.resources, type, result.string(ContactsContract.CommonDataKinds.Phone.LABEL),
            ).toString()
            methods += mapOf(
              "kind" to "phone", "label" to label, "value" to value,
              "isPrimary" to (result.long(ContactsContract.CommonDataKinds.Phone.IS_PRIMARY) == 1L),
            )
          }
          ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> {
            val value = result.string(ContactsContract.CommonDataKinds.Email.ADDRESS) ?: continue
            val type = result.long(ContactsContract.CommonDataKinds.Email.TYPE).toInt()
            val label = ContactsContract.CommonDataKinds.Email.getTypeLabel(
              context.resources, type, result.string(ContactsContract.CommonDataKinds.Email.LABEL),
            ).toString()
            methods += mapOf(
              "kind" to "email", "label" to label, "value" to value,
              "isPrimary" to (result.long(ContactsContract.CommonDataKinds.Email.IS_PRIMARY) == 1L),
            )
          }
        }
      }
    }
    return mapOf(
      "givenName" to givenName,
      "familyName" to familyName,
      "organizationName" to organizationName,
      "methods" to methods,
    )
  }

  private fun readCalls(context: Context, start: CursorPoint, limit: Int): ReadResult {
    val projection = arrayOf(
      CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME,
      CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION,
      CallLog.Calls.PHONE_ACCOUNT_ID,
    )
    val selection = "(${CallLog.Calls.DATE} > ? OR (${CallLog.Calls.DATE} = ? AND ${CallLog.Calls._ID} > ?))"
    val rows = mutableListOf<Map<String, Any?>>()
    val point = start.copy()
    var hasMore = false
    context.contentResolver.query(
      CallLog.Calls.CONTENT_URI, projection, selection,
      arrayOf(start.timestamp.toString(), start.timestamp.toString(), start.id.toString()),
      "${CallLog.Calls.DATE} ASC, ${CallLog.Calls._ID} ASC",
    )?.use { result ->
      var read = 0
      while (result.moveToNext()) {
        if (read >= limit) { hasMore = true; break }
        val id = result.long(CallLog.Calls._ID)
        val occurredAt = result.long(CallLog.Calls.DATE)
        point.timestamp = occurredAt
        point.id = id
        read += 1
        val type = result.long(CallLog.Calls.TYPE).toInt()
        val inbound = type != CallLog.Calls.OUTGOING_TYPE
        val missed = type == CallLog.Calls.MISSED_TYPE ||
          type == CallLog.Calls.REJECTED_TYPE || type == CallLog.Calls.BLOCKED_TYPE
        rows += mapOf(
          "medium" to "call",
          "direction" to if (inbound) "inbound" else "outbound",
          "account" to safeAccount(result.string(CallLog.Calls.PHONE_ACCOUNT_ID)),
          "externalId" to id.toString(),
          "address" to result.string(CallLog.Calls.NUMBER),
          "participants" to listOfNotNull(result.string(CallLog.Calls.NUMBER)?.let { address ->
            mapOf("address" to address, "displayName" to result.string(CallLog.Calls.CACHED_NAME))
          }),
          "displayName" to result.string(CallLog.Calls.CACHED_NAME),
          "callDisposition" to if (missed) "missed" else "answered",
          "callDurationSeconds" to result.long(CallLog.Calls.DURATION).toDouble(),
          "providerStatus" to "android:call:${callTypeName(type)}",
          "occurredAtMs" to occurredAt.toDouble(),
        )
      }
    }
    return ReadResult(rows, point, hasMore)
  }

  private fun callTypeName(type: Int) = when (type) {
    CallLog.Calls.INCOMING_TYPE -> "incoming"
    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
    CallLog.Calls.MISSED_TYPE -> "missed"
    CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
    CallLog.Calls.REJECTED_TYPE -> "rejected"
    CallLog.Calls.BLOCKED_TYPE -> "blocked"
    CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "answered_externally"
    else -> "type_$type"
  }

  private fun readSms(context: Context, start: CursorPoint, limit: Int): ReadResult {
    val projection = arrayOf(
      Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY,
      Telephony.Sms.DATE, Telephony.Sms.DATE_SENT, Telephony.Sms.TYPE,
      Telephony.Sms.THREAD_ID, Telephony.Sms.SUBSCRIPTION_ID, Telephony.Sms.STATUS,
    )
    val selection = "((${Telephony.Sms.DATE} > ? OR (${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} > ?))) AND " +
      "${Telephony.Sms.TYPE} != ?"
    val rows = mutableListOf<Map<String, Any?>>()
    val point = start.copy()
    var hasMore = false
    context.contentResolver.query(
      Telephony.Sms.CONTENT_URI, projection, selection,
      arrayOf(
        start.timestamp.toString(), start.timestamp.toString(), start.id.toString(),
        Telephony.Sms.MESSAGE_TYPE_DRAFT.toString(),
      ),
      "${Telephony.Sms.DATE} ASC, ${Telephony.Sms._ID} ASC",
    )?.use { result ->
      var read = 0
      while (result.moveToNext()) {
        if (read >= limit) { hasMore = true; break }
        val id = result.long(Telephony.Sms._ID)
        val occurredAt = result.long(Telephony.Sms.DATE)
        point.timestamp = occurredAt
        point.id = id
        read += 1
        val type = result.long(Telephony.Sms.TYPE).toInt()
        val inbound = type == Telephony.Sms.MESSAGE_TYPE_INBOX
        val sentAt = result.long(Telephony.Sms.DATE_SENT)
        rows += mapOf(
          "medium" to "sms",
          "direction" to if (inbound) "inbound" else "outbound",
          "account" to "sim_${result.long(Telephony.Sms.SUBSCRIPTION_ID)}",
          "threadKey" to "sms:${result.long(Telephony.Sms.THREAD_ID)}",
          "externalId" to id.toString(),
          "address" to result.string(Telephony.Sms.ADDRESS),
          "participants" to listOfNotNull(result.string(Telephony.Sms.ADDRESS)?.let { address ->
            mapOf("address" to address)
          }),
          "body" to result.string(Telephony.Sms.BODY),
          "deliveryStatus" to smsDeliveryStatus(type),
          "providerStatus" to "android:sms:${smsTypeName(type)}:${result.long(Telephony.Sms.STATUS)}",
          "occurredAtMs" to occurredAt.toDouble(),
          "sentAtMs" to if (!inbound && sentAt > 0) sentAt.toDouble() else null,
          "receivedAtMs" to if (inbound) occurredAt.toDouble() else null,
        )
      }
    }
    return ReadResult(rows, point, hasMore)
  }

  private fun smsTypeName(type: Int) = when (type) {
    Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
    Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
    Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "outbox"
    Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
    Telephony.Sms.MESSAGE_TYPE_QUEUED -> "queued"
    else -> "type_$type"
  }

  private fun smsDeliveryStatus(type: Int) = when (type) {
    Telephony.Sms.MESSAGE_TYPE_INBOX -> "delivered"
    Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
    Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
    else -> "unknown"
  }

  private fun readMms(context: Context, start: CursorPoint, limit: Int): ReadResult {
    val projection = arrayOf(
      Telephony.Mms._ID, Telephony.Mms.DATE, Telephony.Mms.DATE_SENT,
      Telephony.Mms.MESSAGE_BOX, Telephony.Mms.THREAD_ID,
      Telephony.Mms.SUBSCRIPTION_ID, Telephony.Mms.MESSAGE_TYPE,
    )
    val selection = "((${Telephony.Mms.DATE} > ? OR (${Telephony.Mms.DATE} = ? AND ${Telephony.Mms._ID} > ?))) AND " +
      "${Telephony.Mms.MESSAGE_BOX} != ?"
    val rows = mutableListOf<Map<String, Any?>>()
    val point = start.copy()
    var hasMore = false
    context.contentResolver.query(
      Telephony.Mms.CONTENT_URI, projection, selection,
      arrayOf(
        (start.timestamp / 1000).toString(), (start.timestamp / 1000).toString(),
        start.id.toString(), "3",
      ),
      "${Telephony.Mms.DATE} ASC, ${Telephony.Mms._ID} ASC",
    )?.use { result ->
      var read = 0
      while (result.moveToNext()) {
        if (read >= limit) { hasMore = true; break }
        val id = result.long(Telephony.Mms._ID)
        val occurredAt = result.long(Telephony.Mms.DATE) * 1000
        point.timestamp = occurredAt
        point.id = id
        read += 1
        val box = result.long(Telephony.Mms.MESSAGE_BOX).toInt()
        val inbound = box == 1
        val sentAt = result.long(Telephony.Mms.DATE_SENT) * 1000
        rows += mapOf(
          "medium" to "mms",
          "direction" to if (inbound) "inbound" else "outbound",
          "account" to "sim_${result.long(Telephony.Mms.SUBSCRIPTION_ID)}",
          "threadKey" to "mms:${result.long(Telephony.Mms.THREAD_ID)}",
          "externalId" to id.toString(),
          "participants" to readMmsParticipants(context, id, inbound),
          "body" to readMmsText(context, id),
          "deliveryStatus" to if (inbound) "delivered" else if (box == 2) "sent" else "unknown",
          "providerStatus" to "android:mms:box_$box:type_${result.long(Telephony.Mms.MESSAGE_TYPE)}",
          "occurredAtMs" to occurredAt.toDouble(),
          "sentAtMs" to if (!inbound && sentAt > 0) sentAt.toDouble() else null,
          "receivedAtMs" to if (inbound) occurredAt.toDouble() else null,
        )
      }
    }
    return ReadResult(rows, point, hasMore)
  }

  private fun readMmsParticipants(context: Context, messageId: Long, inbound: Boolean): List<Map<String, String>> {
    val uri = Uri.parse("content://mms/$messageId/addr")
    val expectedType = if (inbound) 137 else 151
    val participants = mutableListOf<Map<String, String>>()
    context.contentResolver.query(uri, arrayOf("address", "type"), "type = ?", arrayOf(expectedType.toString()), null)
      ?.use { result ->
        while (result.moveToNext()) {
          val address = result.string("address")
          if (!address.isNullOrBlank() && address != "insert-address-token") {
            participants += mapOf("address" to address)
          }
        }
      }
    return participants.distinctBy { it["address"] }
  }

  private fun readMmsText(context: Context, messageId: Long): String? {
    val parts = mutableListOf<String>()
    context.contentResolver.query(
      Uri.parse("content://mms/part"), arrayOf("_id", "ct", "text", "_data"),
      "mid = ?", arrayOf(messageId.toString()), "_id ASC",
    )?.use { result ->
      while (result.moveToNext()) {
        if (result.string("ct") != "text/plain") continue
        val inline = result.string("text")
        if (!inline.isNullOrBlank()) {
          parts += inline
        } else if (result.string("_data") != null) {
          val partId = result.long("_id")
          val text = runCatching {
            context.contentResolver.openInputStream(
              ContentUris.withAppendedId(Uri.parse("content://mms/part"), partId),
            )?.bufferedReader()?.use { it.readText() }
          }.getOrNull()
          if (!text.isNullOrBlank()) parts += text
        }
      }
    }
    return parts.joinToString("\n").ifBlank { null }
  }

  private fun safeAccount(value: String?): String {
    val selected = value?.trim().orEmpty().ifBlank { "default" }
    return selected.replace(Regex("[^A-Za-z0-9._:@+\\-]"), "_").take(96)
  }
}
