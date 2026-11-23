package expo.modules.shotfolderkeystore

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Chave do aparelho no Android Keystore.
 *
 * - Par EC P-256 gerado DENTRO do hardware seguro (StrongBox, se o aparelho tiver;
 *   senão o TEE). A chave privada nunca sai de lá: nem o próprio app consegue lê-la,
 *   só pedir assinaturas.
 * - setUnlockedDeviceRequired: com o celular bloqueado, a chave não assina.
 * - Não exige digital a cada uso, para a fila conseguir enviar sozinha.
 * - A pública sai em SPKI/DER (base64), o formato que o PC guarda.
 * - A assinatura é "SHA256withECDSA" em DER, o formato que o PC confere.
 */
class ShotfolderKeystoreModule : Module() {
  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun spec(alias: String, strongBox: Boolean): KeyGenParameterSpec {
    val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      b.setUnlockedDeviceRequired(true)
      if (strongBox) b.setIsStrongBoxBacked(true)
    }
    return b.build()
  }

  private fun publicKeyBase64(alias: String): String {
    val cert = keyStore().getCertificate(alias) ?: throw CodedException("ERR_NO_KEY", "Chave não encontrada: $alias", null)
    return Base64.encodeToString(cert.publicKey.encoded, Base64.NO_WRAP)
  }

  /** Onde a chave mora: "strongbox", "tee" ou "software". */
  private fun securityLevel(alias: String): String {
    val key = keyStore().getKey(alias, null) as? PrivateKey ?: return "desconhecido"
    val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
        else -> "desconhecido"
      }
    } else {
      @Suppress("DEPRECATION")
      if (info.isInsideSecureHardware) "tee" else "software"
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ShotfolderKeystore")

    Function("hasKey") { alias: String ->
      keyStore().containsAlias(alias)
    }

    /** Gera (ou substitui) o par de chaves. Devolve a chave pública e onde ela ficou. */
    AsyncFunction("generateKey") { alias: String ->
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      try {
        gen.initialize(spec(alias, strongBox = true))
        gen.generateKeyPair()
      } catch (e: StrongBoxUnavailableException) {
        // Aparelho sem StrongBox: fica no TEE (ainda hardware, só não um chip separado).
        gen.initialize(spec(alias, strongBox = false))
        gen.generateKeyPair()
      }
      mapOf("publicKeySpki" to publicKeyBase64(alias), "securityLevel" to securityLevel(alias))
    }

    Function("getPublicKey") { alias: String ->
      publicKeyBase64(alias)
    }

    Function("getSecurityLevel") { alias: String ->
      securityLevel(alias)
    }

    /** Assina o texto (UTF-8). Falha com ERR_KEY_LOCKED se o celular estiver bloqueado. */
    AsyncFunction("sign") { alias: String, text: String ->
      val key = keyStore().getKey(alias, null) as? PrivateKey
        ?: throw CodedException("ERR_NO_KEY", "Chave não encontrada: $alias", null)
      try {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(key)
        s.update(text.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(s.sign(), Base64.NO_WRAP)
      } catch (e: Exception) {
        // Com setUnlockedDeviceRequired, o Keystore recusa a chave com a tela bloqueada.
        throw CodedException("ERR_KEY_LOCKED", "Não foi possível assinar (celular bloqueado?): ${e.message}", e)
      }
    }

    Function("deleteKey") { alias: String ->
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
    }
  }
}
